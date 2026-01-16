import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractJsonBlock, safeJsonParse } from "./utils.js";
import { validateAiScore } from "./scoring.js";

function buildPrompt(opportunity, descriptionText, attachmentText, companyProfile) {
  return `You are an expert government contract analyst working for a business development team. Your task is to analyze the following federal contracting opportunity, including its attachments, and provide a concise, structured summary in JSON format. The goal is to give the team all the key information needed for a rapid "go/no-go" decision.

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
  "is_relevant": boolean, // Is this a pre-solicitation, sources sought, or solicitation? (true if yes, false if it's an award notice or other non-opportunity)
  "plain_english_summary": string, // A clear, concise summary of the core requirement. Translate all government acronyms into plain English.
  "required_skillsets": string[], // A list of the primary technical and professional skills needed to successfully perform the work.
  "fit_label": "GOOD_FIT" | "MAYBE" | "NOT_A_FIT",
  "fit_score": number, // A score from 0-100 indicating how well this opportunity aligns with our company profile.
  "reasons": string[], // Bullet points explaining why this is or is not a good fit.
  "risks": string[], // Potential risks or challenges in pursuing this contract.
  "key_dates": {
    "due_date": string, // The most important response deadline.
    "other_dates": string[] // Any other relevant dates mentioned (e.g., question submission deadlines, site visits).
  },
  "attachment_summary": string, // A brief summary of what was found in the attachments.
  "must_check_items": string[] // Specific items or sections the team *must* review in the attachments before making a decision.
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
