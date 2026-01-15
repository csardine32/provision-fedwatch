import fs from "fs";
import { sleep } from "./utils.js";

class SamApiError extends Error {
  constructor(message, status, text) {
    super(message);
    this.name = "SamApiError";
    this.status = status;
    this.text = text;
  }
}

async function isQuotaExceeded(resp) {
  try {
    const clone = resp.clone();
    const text = await clone.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = text;
    }
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    return /exceeded your quota/i.test(raw) || /nextAccessTime/i.test(raw);
  } catch (_) {
    return false;
  }
}

function buildSearchUrl(baseUrl, params) {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith("/opportunities/v2/search")) {
    base.pathname = `${base.pathname.replace(/\/$/, "")}/opportunities/v2/search`;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          search.append(key, String(item));
        }
      }
    } else {
      search.set(key, String(value));
    }
  }
  base.search = search.toString();
  return base.toString();
}

async function fetchWithRetry(url, { fetchImpl, logger, maxAttempts = 4 }) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const resp = await fetchImpl(url, { method: "GET" });
      if (resp.status === 429) {
        const quotaExceeded = await isQuotaExceeded(resp);
        if (quotaExceeded) return resp;
      }
      if (resp.status < 500) {
        return resp;
      }
      // Retry on 5xx errors
      const wait = Math.min(2000 * attempt, 8000);
      logger.warn({
        message: "SAM API request failed, retrying...",
        attempt,
        maxAttempts,
        status: resp.status,
        url,
      });
      await sleep(wait);
    } catch (error) {
      const wait = Math.min(2000 * attempt, 8000);
      logger.warn({
        message: "SAM API request failed, retrying...",
        attempt,
        maxAttempts,
        error: error.message,
        url,
      });
      await sleep(wait);
    }
  }
  // Last attempt
  return fetchImpl(url, { method: "GET" });
}

async function fetchOpportunitiesForNaics(ncode, { apiKey, baseUrl, postedFrom, postedTo, limit, filters, maxPages, fetchImpl, logger }) {
    const results = [];
    let offset = 0;
    let totalRecords = null;
    let pagesFetched = 0;
    const pageBudget = Number.isFinite(maxPages) ? maxPages : null;

    while (true) {
        const params = {
            api_key: apiKey,
            postedFrom,
            postedTo,
            limit,
            offset,
            ptype: filters.ptype,
            ncode: ncode, // Use the single ncode
            ccode: filters.psc,
            organizationName: filters.organizationName,
            state: filters.state,
            zip: filters.zip,
            rdlfrom: filters.rdlfrom,
            rdlto: filters.rdlto,
            keyword: filters.keywords,
        };
        const url = buildSearchUrl(baseUrl, params);
        logger.debug("SAM request", url);
        const resp = await fetchWithRetry(url, { fetchImpl, logger });
        if (resp.status === 429 && (await isQuotaExceeded(resp))) {
            logger.warn("[sam] Quota exceeded; stopping early");
            break;
        }
        if (!resp.ok) {
            const text = await resp.text();
            throw new SamApiError(`SAM API error ${resp.status}`, resp.status, text);
        }
        const json = await resp.json();
        const batch = json?.opportunitiesData ?? [];
        results.push(...batch);
        totalRecords = json?.totalRecords ?? totalRecords ?? results.length;
        pagesFetched += 1;
        if (pageBudget !== null && pagesFetched >= pageBudget) {
            logger.warn(`[sam] Reached max_pages_per_run=${pageBudget}; stopping early`);
            break;
        }
        offset += limit;
        if (results.length >= totalRecords || batch.length === 0) break;
    }

    return results;
}

export async function fetchSamOpportunities({
  apiKey,
  baseUrl,
  postedFrom,
  postedTo,
  limit,
  filters,
  maxPages,
  fetchImpl,
  logger,
}) {
  const fixturePath = process.env.SAM_FIXTURE_PATH;
  if (fixturePath) {
    logger.info(`[sam] Using fixture: ${fixturePath}`);
    const raw = fs.readFileSync(fixturePath, "utf8");
    const data = JSON.parse(raw);
    let opportunities = [];
    if (Array.isArray(data)) {
      opportunities = data;
    } else if (Array.isArray(data?.opportunitiesData)) {
      opportunities = data.opportunitiesData;
    } else if (Array.isArray(data?.opportunities)) {
      opportunities = data.opportunities;
    }
    return { totalRecords: opportunities.length, opportunities };
  }

  const allOpportunities = [];
  const naicsCodes = filters.naics;

  if (naicsCodes && naicsCodes.length > 0) {
    for (const ncode of naicsCodes) {
      const opportunities = await fetchOpportunitiesForNaics(ncode, { apiKey, baseUrl, postedFrom, postedTo, limit, filters, maxPages, fetchImpl, logger });
      allOpportunities.push(...opportunities);
    }
  } else {
    const opportunities = await fetchOpportunitiesForNaics(null, { apiKey, baseUrl, postedFrom, postedTo, limit, filters, maxPages, fetchImpl, logger });
    allOpportunities.push(...opportunities);
  }

  // Deduplicate opportunities
  const uniqueOpportunities = [...new Map(allOpportunities.map(item => [item.noticeId, item])).values()];

  return { totalRecords: uniqueOpportunities.length, opportunities: uniqueOpportunities };
}