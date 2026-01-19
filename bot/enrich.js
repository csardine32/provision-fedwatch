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
      if (link && typeof link === 'string' && link.startsWith('http')) {
        links.push(link);
      } else if (link?.url && typeof link.url === 'string' && link.url.startsWith('http')) {
        links.push(link.url);
      }
    }
  }
  return links;
}

async function downloadAttachment(url, { fetchImpl, logger, downloadDir }) {
  try {
    const resp = await fetchImpl(url);
    if (!resp.ok) {
      logger.warn(`Failed to download attachment ${url}: ${resp.status}`);
      return null;
    }

    let filename = 'download';
    const contentDisposition = resp.headers.get('Content-Disposition');
    if (contentDisposition) {
      const match = /filename\*?=(?:"([^"]+)"|([^;]+))/.exec(contentDisposition);
      if (match) {
        filename = match[1] || match[2]; // Use the first matching group (quoted or unquoted)
      }
    } else {
      // Fallback to URL pathname if Content-Disposition is not present
      const urlPathname = new URL(url).pathname;
      const base = path.basename(urlPathname);
      if (base && base.includes('.')) { // Simple check for an extension
        filename = base;
      }
    } // Removed the else block for Content-Type inference as per instruction

    const downloadPath = path.join(downloadDir, filename);

    const buffer = await resp.arrayBuffer();
    fs.writeFileSync(downloadPath, Buffer.from(buffer));
    return downloadPath;
  } catch (error) {
    logger.warn(`Error downloading attachment ${url}: ${error.message}`);
    return null;
  }
}

import pdf from 'pdf-parse';
import WordExtractor from 'word-extractor';

const wordExtractor = new WordExtractor();

// ... (rest of the file remains the same until extractTextFromFile)

async function extractTextFromFile(filePath, logger) {
  const extension = path.extname(filePath).toLowerCase();

  try {
    if (extension === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      return data.text;
    } else if (extension === '.doc' || extension === '.docx') {
      const extracted = await wordExtractor.extract(filePath);
      return extracted.getBody();
    } else if (extension === '.txt') {
      return fs.readFileSync(filePath, 'utf8');
    } else {
      logger.warn(`Skipping text extraction for unsupported file type: ${filePath}`);
      return "";
    }
  } catch (error) {
    logger.warn(`Error extracting text from ${filePath}: ${error.message}`);
    return "";
  }
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

  // Pass downloadDir to downloadAttachment
  const downloadedFile = await downloadAttachment(url.toString(), { fetchImpl, logger, downloadDir });

  if (!downloadedFile) {
    return "";
  }

  const text = await extractTextFromFile(downloadedFile, logger);

  fs.unlinkSync(downloadedFile); // Clean up the downloaded file

  return clampText(text, maxChars);
}
