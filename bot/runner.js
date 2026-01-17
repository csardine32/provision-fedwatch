import { loadConfig, requireEnv } from "./config.js";
import { createLogger } from "./logger.js";
import { fetchSamOpportunities } from "./sam_client.js";
import { normalizeOpportunity } from "./normalizer.js";
import { fetchDescriptionText, fetchAttachmentText } from "./enrich.js";
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runProfile(profile, { db, logger, dryRun, backfillDays, fetchImpl, now }) {
  logger.debug('ENV Keys in runner:', Object.keys(process.env));
  const nowIso = now.toISOString();
  const lookbackDays = backfillDays ?? profile.sam.posted_lookback_days ?? 1;
  const postedFrom = formatDateMMDDYYYY(new Date(now.getTime() - lookbackDays * 86400000));
  const postedTo = formatDateMMDDYYYY(now);

  const samApiKey = requireEnv(profile.sam.api_key_env);

  const { opportunities } = await fetchSamOpportunities({
    apiKey: samApiKey,
    baseUrl: profile.sam.base_url,
    postedFrom,
    postedTo,
    limit: profile.sam.limit ?? 100,
    maxPages: profile.sam.max_pages_per_run,
    filters: profile.sam.filters ?? {},
    fetchImpl,
    logger,
  });

  logger.info(`[${profile.name}] Fetched ${opportunities.length} opportunities from SAM.gov.`);

  const summary = {
    profile: profile.name,
    total: opportunities.length,
    scored: 0,
    alerted: 0,
    skipped: 0,
  };
  let descriptionFetches = 0;
  let capLogged = false;
  const descriptionCap = profile.sam.max_descriptions_per_run ?? 10;
  let goodFitAlertsSent = 0; // Initialize counter for GOOD_FIT alerts
  const batchSize = 10;

  for (let i = 0; i < opportunities.length; i += batchSize) {
    const batch = opportunities.slice(i, i + batchSize);
    logger.info(`[${profile.name}] Processing batch ${i / batchSize + 1} of ${Math.ceil(opportunities.length / batchSize)}`);
    for (const raw of batch) {
      const normalized = normalizeOpportunity(raw);
      if (!normalized.noticeId) {
        logger.warn("Skipping opportunity without noticeId");
        summary.skipped += 1;
        continue;
      }

      let descriptionText = "";
      if (profile.sam.fetch_descriptions) {
        if (descriptionFetches < descriptionCap) {
          descriptionText = await fetchDescriptionText({
            opportunity: normalized,
            apiKey: samApiKey,
            fetchImpl,
            logger,
            maxChars: profile.sam.description_max_chars ?? 16000,
          });
          descriptionFetches += 1;
        } else if (!capLogged) {
          logger.info(`[sam] Skipping description fetch due to cap (max=${descriptionCap})`);
          capLogged = true;
        }
      }

      let attachmentText = "";
      if (profile.sam.fetch_attachments) {
          attachmentText = await fetchAttachmentText({
              opportunity: normalized,
              apiKey: samApiKey,
              fetchImpl,
              logger,
          });
      }

      const hash = buildOpportunityHash(normalized, descriptionText, attachmentText);
      await upsertOpportunity(db, normalized, descriptionText, attachmentText, hash, nowIso, { logger });
      const state = await getOpportunityState(db, normalized.noticeId);

      if (state?.hash === hash && state?.last_scored_at) {
        summary.skipped += 1;
        continue;
      }

      const thresholds = {
        minGood: profile.scoring.min_good_fit_score ?? 75,
        minMaybe: profile.scoring.min_maybe_score ?? 55,
      };
      const pre = deterministicScore(normalized, descriptionText);
      let aiScore = null;

      if (profile.scoring.ai_enabled) {
        const aiProvider = process.env.AI_PROVIDER ?? "gemini";
        let aiKey = null;
        if (aiProvider === "openai") {
          aiKey = process.env.OPENAI_API_KEY;
        } else if (aiProvider === "gemini") {
          aiKey = process.env.GEMINI_API_KEY;
        }

        if (aiKey) {
          aiScore = await scoreWithAi({
            apiKey: aiKey,
            model: profile.scoring.ai_model,
            opportunity: normalized,
            descriptionText,
            attachmentText,
            companyProfile: profile.company_profile,
            logger,
          });
        } else {
          logger.warn(`[${profile.name}] ${aiProvider.toUpperCase()}_API_KEY not set; AI scoring disabled.`);
        }
      }

      const score = aiScore ?? buildFallbackScore(pre.preScore, thresholds);
      if (!aiScore) {
        score.fit_label = scoreToLabel(score.fit_score, thresholds);
      }

      await saveScore(db, normalized.noticeId, score, nowIso);
      summary.scored += 1;

      if (shouldAlert({ score, config: profile, state, hash })) {
        // Cap GOOD_FIT alerts for testing purposes
        if (score.fit_label === "GOOD_FIT") {
          if (profile.alerting.max_good_fit_alerts && goodFitAlertsSent >= profile.alerting.max_good_fit_alerts) {
            logger.info(`[${profile.name}] Max GOOD_FIT alerts (${profile.alerting.max_good_fit_alerts}) reached; skipping alert for ${normalized.title}`);
            continue; // Skip alerting this opportunity
          }
          goodFitAlertsSent++;
        }

        try {
          const payload = buildSlackPayload({ opportunity: normalized, score });
          if (dryRun) {
            logger.info(`[${profile.name}] [dry-run] Would alert ${score.fit_label}: ${normalized.title}`);
          } else {
            const slackWebhook = profile.slack?.webhook_url_env
              ? process.env[profile.slack.webhook_url_env]
              : null;
            const slackBotToken = profile.slack?.bot_token_env ? process.env[profile.slack.bot_token_env] : null;
            const slackChannel = profile.slack?.channel ?? null;

            if (slackBotToken && slackChannel) {
              await postSlackMessage({ token: slackBotToken, channel: slackChannel, payload, fetchImpl });
            } else if (slackWebhook) {
              await postSlackAlert({ webhookUrl: slackWebhook, payload, fetchImpl });
            } else {
              logger.warn(`[${profile.name}] No Slack configuration found for live run.`);
            }

            await saveAlert(db, normalized.noticeId, score, payload, nowIso, hash);
            logger.info(`[${profile.name}] Alerted ${score.fit_label}: ${normalized.title}`);
          }
          summary.alerted += 1;
        } catch (error) {
          logger.error(`[${profile.name}] Failed to send alert for opportunity ${normalized.noticeId}: ${error.message}`);
          logger.debug(error);
        }
      }
    }
    if (global.gc) {
      logger.info(`[${profile.name}] Triggering garbage collection after batch`);
      global.gc();
    }
    await sleep(2000); // Wait for 2 seconds between batches
  }

  logger.info(
    `[${profile.name}] Summary: total=${summary.total} scored=${summary.scored} alerted=${summary.alerted} skipped=${summary.skipped}`
  );
  return summary;
}

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
  logger.info("[debug] Bypassing database initialization for hang test.");
  // const db = await initStorage(config.storage.sqlite_path);

  // const summaries = [];
  // for (const profile of config.profiles) {
  //   const summary = await runProfile(profile, { db, logger, dryRun, backfillDays, fetchImpl, now });
  //   summaries.push(summary);
  // }
  // return summaries;
}