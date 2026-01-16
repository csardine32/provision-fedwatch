import { clampText } from "./utils.js";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

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

function extractAttachmentLinks(opportunity) {
  const links = [];
  if (Array.isArray(opportunity.resourceLinks)) {
    for (const link of opportunity.resourceLinks) {
      if (link && typeof link === 'string' && link.includes('?api_key=')) {
        links.push(link);
      } else if (link?.url && typeof link.url === 'string' && link.url.includes('?api_key=')) {
        links.push(link.url);
      }
    }
  }
  return links;
}

async function downloadAttachment(url, downloadPath, { fetchImpl, logger }) {
  try {
    const resp = await fetchImpl(url);
    if (!resp.ok) {
      logger.warn(`Failed to download attachment ${url}: ${resp.status}`);
      return null;
    }
    const buffer = await resp.arrayBuffer();
    fs.writeFileSync(downloadPath, Buffer.from(buffer));
    return downloadPath;
  } catch (error) {
    logger.warn(`Error downloading attachment ${url}: ${error.message}`);
    return null;
  }
}

function extractTextFromPdf(filePath, logger) {
  return new Promise((resolve) => {
    exec(`pdftotext -layout "${filePath}" -`, (error, stdout, stderr) => {
      if (error) {
        logger.warn(`pdftotext error for ${filePath}: ${stderr}`);
        resolve("");
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function fetchAttachmentText({
  opportunity,
  apiKey,
  fetchImpl,
  logger,
  maxChars = 32000,
  downloadDir = "/tmp",
}) {
  const attachmentLinks = extractAttachmentLinks(opportunity);
  if (attachmentLinks.length === 0) {
    return "";
  }

  // For now, only process the first attachment to save time and API calls
  const firstLink = attachmentLinks[0];
  const url = new URL(firstLink);
  if (!url.searchParams.has("api_key")) {
    url.searchParams.set("api_key", apiKey);
  }

  const fileName = path.basename(url.pathname);
  const downloadPath = path.join(downloadDir, fileName);

  const downloadedFile = await downloadAttachment(url.toString(), downloadPath, { fetchImpl, logger });

  if (!downloadedFile) {
    return "";
  }

  let text = "";
  if (downloadedFile.toLowerCase().endsWith(".pdf")) {
    text = await extractTextFromPdf(downloadedFile, logger);
  } else {
    logger.warn(`Skipping text extraction for non-PDF file: ${downloadedFile}`);
  }

  fs.unlinkSync(downloadedFile); // Clean up the downloaded file

  return clampText(text, maxChars);
}