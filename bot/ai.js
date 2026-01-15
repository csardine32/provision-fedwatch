import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractJsonBlock, safeJsonParse } from "./utils.js";
import { validateAiScore } from "./scoring.js";

const COMPANY_PROFILE = `
RMC Integration Services LLC: IT and telecommunications managed services and staffing.
Core competencies:
- End-to-end project delivery
- Supplemental staffing
- Technology and project assessments
- IT infrastructure
- IP video delivery
- Cable MSO architecture
Servicing Fortune 500, mid-market, and emerging markets across all industries.
`.trim();

function buildPrompt(opportunity, descriptionText, companyProfile) {
  return `Score this federal opportunity for the following company.\n\nReturn ONLY valid JSON matching the schema provided. Do not wrap in markdown.\n\nCompany profile:\n${companyProfile}\n\nOpportunity (normalized JSON):\n${JSON.stringify(opportunity, null, 2)}\n\nDescription text (if any):\n${descriptionText || "[none]"}\n\nRequired JSON schema:\n{\n  "fit_label": "GOOD_FIT" | "MAYBE" | "NOT_A_FIT",\n  "fit_score": number,\n  "confidence": number,\n  "reasons": string[],\n  "risks": string[],\n  "recommended_next_steps": string[],\n  "suggested_teaming_angle": string | null,\n  "tags": string[],\n  "must_check_items": string[]\n}`;
}

export async function scoreWithAi({
  apiKey,
  model: modelName,
  opportunity,
  descriptionText,
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

      const prompt = buildPrompt(opportunity, descriptionText, companyProfile);
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
      if (error.message && error.message.includes("429 Too Many Requests")) {
        const retryDelayMatch = error.message.match(/Please retry in (\d+\.\d+)s/);
        let retryDelay = 5000 * attempt; // default backoff
        if (retryDelayMatch && retryDelayMatch[1]) {
          retryDelay = Math.ceil(parseFloat(retryDelayMatch[1]) * 1000);
        }
        
        logger.warn(
          `AI scoring failed with 429 error. Retrying in ${retryDelay}ms...`
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