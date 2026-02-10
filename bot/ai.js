import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractJsonBlock, safeJsonParse } from "./utils.js";
import { validateAiScore } from "./scoring.js";

function buildPrompt(opportunity, descriptionText, attachmentText, companyProfile) {
  return `You are an expert government contract analyst performing go/no-go analysis for a small business. Analyze this opportunity and return a structured JSON summary.

**HARD DISQUALIFIERS — score 0 and set is_relevant to false if ANY apply:**
- This is an award notice, contract modification, or already-awarded contract (not an open solicitation)
- The opportunity has already been awarded to a specific company
- The requirement is explicitly sole-sourced to a named vendor

**ELIGIBILITY RED FLAGS — note in risks and reduce score significantly:**
- Requires 8(a) certification (unless the company profile states 8(a) status)
- Requires Top Secret, TS/SCI, or Secret clearance (unless company profile states clearance)
- Incumbent-locked recompete with highly specialized requirements tied to existing vendor
- Contract value exceeds $25M (unrealistic for small business unless task-order based)

**SCORING GUIDANCE:**
Score based on how well the opportunity matches the company profile below. Be strict and realistic.

70-100 (GOOD_FIT): The core requirement directly matches the company's stated capabilities. For IT-focused profiles, this means the primary deliverable is software, data analytics, system integration, SaaS, cybersecurity, IT managed services, or similar technology work.

30-69 (MAYBE): There is some component matching the company profile, but it's not the primary requirement, or the opportunity needs teaming partners for key areas, or there are capability gaps.

0-29 (NOT_A_FIT): The core work does not match the company profile. Physical labor, facilities maintenance, construction, groundskeeping, trash removal, custodial services, food service, vehicle maintenance, or similar non-matching work should score NOT_A_FIT even if there is a minor technology component (e.g., a trash removal contract with digital scheduling is still trash removal — score NOT_A_FIT for an IT company). Similarly, opportunities requiring certifications or clearances the company doesn't hold should score very low.

**CONTRACT SIZE REALITY CHECK**
As a small business, we target contracts under $25M. Prefer opportunities in the $100K-$10M range. Over $50M is unrealistic unless clearly divisible into smaller task orders.

**Company Profile:**
${companyProfile}

**Opportunity Data (JSON):**
${JSON.stringify(opportunity, null, 2)}

**Official Description Text:**
${descriptionText || "[none]"}

**Attachment Content:**
${attachmentText || "[none]"}

---

**Required JSON Output Schema:**

{
  "is_relevant": boolean, // false for award notices, modifications, already-awarded, or sole-sourced contracts. true only for open solicitations we can bid on.
  "plain_english_summary": string, // Clear, concise summary of the core requirement. Translate government acronyms.
  "required_skillsets": string[], // Primary technical and professional skills needed.
  "fit_label": "GOOD_FIT" | "MAYBE" | "NOT_A_FIT",
  "fit_score": number, // 0-100 based on scoring guidance above. Be strict — only score GOOD_FIT when the core work genuinely matches the company profile.
  "reasons": string[], // Why this is or is not a good fit. Be specific about what matches or doesn't match.
  "risks": string[], // Risks including eligibility concerns, clearance gaps, incumbent advantages, teaming needs.
  "key_dates": {
    "due_date": string, // Most important response deadline.
    "other_dates": string[] // Other relevant dates (question deadlines, site visits, etc.).
  },
  "attachment_summary": string, // Brief summary of attachment contents.
  "must_check_items": string[] // Specific items the team must review before deciding.
}`;
}

export async function scoreWithAi({
  apiKey,
  model: modelName,
  opportunity,
  descriptionText,
  attachmentText, // New parameter
  companyProfile,
  logger,
  maxRetries = 5,
}) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = buildPrompt(opportunity, descriptionText, attachmentText, companyProfile);
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const content = response.text();

      const extracted = extractJsonBlock(content);
      const parsed = safeJsonParse(extracted);
      if (!parsed.ok || !validateAiScore(parsed.value)) {
        throw new Error("Invalid AI JSON response");
      }
      return parsed.value;
    } catch (error) {
      const is429 = error.message && error.message.includes("429 Too Many Requests");
      const is5xx = error.message && /5\d{2}/.test(error.message); // regex for 5xx status codes

      if (is429 || is5xx) {
        const retryDelayMatch = error.message.match(/Please retry in (\d+\.\d+)s/);
        let retryDelay = 5000 * attempt; // default backoff
        if (retryDelayMatch && retryDelayMatch[1]) {
          retryDelay = Math.ceil(parseFloat(retryDelayMatch[1]) * 1000);
        }
        
        const reason = is429 ? "429 rate limit" : "5xx server error";
        logger.warn(
          `AI scoring failed with ${reason}. Retrying in ${retryDelay}ms... (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }
      logger.warn("AI scoring failed", error.message);
      return null;
    }
  }
  logger.error("AI scoring failed after multiple retries.");
  return null;
}
