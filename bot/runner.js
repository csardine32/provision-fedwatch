import { loadConfig, requireEnv } from "./config.js";
import { createLogger } from "./logger.js";
import { fetchSamOpportunities } from "./sam_client.js";
import { normalizeOpportunity } from "./normalizer.js";
import { fetchDescriptionText } from "./enrich.js";
import {
  buildOpportunityHash,
  deterministicScore,
  scoreToLabel,
  shouldAlert,
  buildFallbackScore,
} from "./scoring.js";
import { scoreWithAi } from "./ai.js";
import { buildSlackPayload, postSlackAlert, postSlackMessage } from "./slack.js";
import { initStorage, upsertOpportunity, getOpportunityState, saveScore, saveAlert } from "./storage.js";
import { formatDateMMDDYYYY } from "./utils.js";
/*
*/
console.log("runner.js loaded with storage and utils imports");

export async function runOpportunityBot({
  dryRun = false,
  backfillDays = null,
  configPath = null,
  fetchImpl = fetch,
  now = new Date(),
  verbose = false,
} = {}) {
  const { config } = loadConfig(configPath);
  const logger = createLogger({ verbose });
  const db = await initStorage(config.storage.sqlite_path); // This might cause a hang if storage.js is the issue
  console.log("runOpportunityBot called with storage and utils imports");
  logger.info("...and storage and utils loaded successfully");
}
