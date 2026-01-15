import { clampText } from "./utils.js";

function resolveDescriptionUrl(opportunity) {
  const candidate = opportunity.descriptionLink;
  if (typeof candidate === "string" && candidate.startsWith("http")) return candidate;
  return "";
}

export async function fetchDescriptionText({
  opportunity,
  apiKey,
  fetchImpl,
  logger,
  maxChars = 16000,
}) {
  const url = resolveDescriptionUrl(opportunity);
  if (!url) return "";
  const descriptionUrl = new URL(url);
  if (!descriptionUrl.searchParams.get("api_key")) {
    descriptionUrl.searchParams.set("api_key", apiKey);
  }
  try {
    const resp = await fetchImpl(descriptionUrl.toString(), { method: "GET" });
    if (!resp.ok) {
      logger.warn(`Description fetch failed ${resp.status} for ${opportunity.noticeId}`);
      return "";
    }
    const text = await resp.text();
    return clampText(text, maxChars);
  } catch (error) {
    logger.warn(`Description fetch error for ${opportunity.noticeId}`, error.message);
    return "";
  }
}
