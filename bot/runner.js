import { loadConfig, requireEnv } from "./config.js";
/*
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
*/
console.log("runner.js loaded with config import");

export async function runOpportunityBot({
  dryRun = false,
  backfillDays = null,
  configPath = null,
  fetchImpl = fetch,
  now = new Date(),
  verbose = false,
} = {}) {
  const { config } = loadConfig(configPath);
  console.log("runOpportunityBot called with config import");
  console.log("Config loaded:", config);
}