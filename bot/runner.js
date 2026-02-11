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
  blendScores,
} from "./scoring.js";
import { scoreWithAi } from "./ai.js";
import { checkEligibility } from "./eligibility.js";
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

  let { opportunities } = await fetchSamOpportunities({
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

  if (Array.isArray(profile.sam.filters?.setAsideCodes) && profile.sam.filters.setAsideCodes.length > 0) {
    const originalCount = opportunities.length;
    opportunities = opportunities.filter(opp => {
      const normalized = normalizeOpportunity(opp);
      return profile.sam.filters.setAsideCodes.includes(normalized.setAsideCode);
    });
    logger.info(`[${profile.name}] Filtered ${originalCount} opportunities down to ${opportunities.length} based on setAsideCodes.`);
  }

  const summary = {
    profile: profile.name,
    total: opportunities.length,
    scored: 0,
    alerted: 0,
    skipped: 0,
    disqualified: 0,
    aiCalls: 0,
    aiFallbacks: 0,
  };
  let descriptionFetches = 0;
  let capLogged = false;
  const descriptionCap = profile.sam.max_descriptions_per_run ?? 10;
  let goodFitAlertsSent = 0;
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

      const hash = buildOpportunityHash(normalized, descriptionText, "");  // attachments analyzed on-demand only
      await upsertOpportunity(db, normalized, descriptionText, attachmentText, hash, nowIso, { logger });
      const state = await getOpportunityState(db, normalized.noticeId);

      logger.debug(`[${profile.name}] Checking skip condition for ${normalized.noticeId}:\n  - New Hash: ${hash}\n  - DB Hash:  ${state?.hash}\n  - Scored at: ${state?.last_scored_at}`);

      if (state?.hash === hash && state?.last_scored_at) {
        summary.skipped += 1;
        continue;
      }

      const thresholds = {
        minGood: profile.scoring.min_good_fit_score ?? 75,
        minMaybe: profile.scoring.min_maybe_score ?? 55,
      };

      // Eligibility gate — check before spending AI calls
      const eligibility = checkEligibility(
        normalized,
        descriptionText,
        profile.company_eligibility ?? {},
      );

      if (!eligibility.isEligible) {
        const disqualifyReasons = eligibility.issues
          .filter((i) => i.severity === "disqualifying")
          .map((i) => i.message);
        const score = {
          is_relevant: false,
          plain_english_summary: "Auto-disqualified by eligibility gate.",
          required_skillsets: [],
          fit_label: "NOT_A_FIT",
          fit_score: 0,
          reasons: disqualifyReasons,
          risks: disqualifyReasons,
          key_dates: { due_date: "", other_dates: [] },
          attachment_summary: "",
          must_check_items: [],
        };
        await saveScore(db, normalized.noticeId, score, nowIso);
        summary.scored += 1;
        summary.disqualified += 1;
        logger.info(`[${profile.name}] Disqualified: ${normalized.title} — ${disqualifyReasons.join("; ")}`);
        continue;
      }

      // Pass config keywords to deterministic scoring
      const configKeywords = (profile.scoring.positive_keywords || profile.scoring.negative_keywords)
        ? {
            positive: profile.scoring.positive_keywords,
            negative: profile.scoring.negative_keywords,
          }
        : undefined;
      const pre = deterministicScore(normalized, descriptionText, configKeywords);
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
          summary.aiCalls += 1;
          aiScore = await scoreWithAi({
            apiKey: aiKey,
            model: profile.scoring.ai_model,
            opportunity: normalized,
            descriptionText,
            attachmentText: "",  // attachments analyzed on-demand only
            companyProfile: profile.company_profile,
            logger,
          });
          if (!aiScore) summary.aiFallbacks += 1;
        } else {
          logger.warn(`[${profile.name}] ${aiProvider.toUpperCase()}_API_KEY not set; AI scoring disabled.`);
        }
      }

      const score = blendScores(pre, aiScore, eligibility, thresholds);

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
          const payload = buildSlackPayload({ opportunity: normalized, score, companyProfile: profile.company_profile });
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
    `[${profile.name}] Summary: total=${summary.total} scored=${summary.scored} alerted=${summary.alerted} skipped=${summary.skipped} disqualified=${summary.disqualified} aiCalls=${summary.aiCalls} aiFallbacks=${summary.aiFallbacks}`
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
  profileNames = [],
} = {}) {
  console.log("[runner] Starting runOpportunityBot.");
  console.log("[runner] Calling loadConfig...");
  const { config } = loadConfig(configPath);
  console.log("[runner] loadConfig returned. Config loaded: ", config.profiles.map(p => p.name).join(", "));
  console.log("[runner] Calling createLogger...");
  const logger = createLogger({ verbose });
  console.log("[runner] createLogger returned.");
  console.log("[runner] Calling initStorage...");
  const db = await initStorage(config.storage.sqlite_path);
  console.log("[runner] initStorage returned.");

  const summaries = [];
  const profilesToRun = profileNames.length > 0
    ? config.profiles.filter(p => profileNames.includes(p.name))
    : config.profiles;

  console.log(`[runner] Starting profile loop for: ${profilesToRun.map(p => p.name).join(", ")}`);
  for (const profile of profilesToRun) {
    console.log(`[runner] Running profile: ${profile.name}...`);
    const summary = await runProfile(profile, { db, logger, dryRun, backfillDays, fetchImpl, now });
    summaries.push(summary);
    console.log(`[runner] Finished profile: ${profile.name}.`);
  }
  // Aggregate API usage across all profiles
  const totals = summaries.reduce((acc, s) => {
    acc.aiCalls += s.aiCalls || 0;
    acc.aiFallbacks += s.aiFallbacks || 0;
    acc.disqualified += s.disqualified || 0;
    acc.scored += s.scored || 0;
    acc.alerted += s.alerted || 0;
    return acc;
  }, { aiCalls: 0, aiFallbacks: 0, disqualified: 0, scored: 0, alerted: 0 });

  const savedCalls = totals.disqualified;
  logger.info(`[runner] Run complete — Gemini API calls: ${totals.aiCalls} (${totals.aiFallbacks} failed) | Disqualified before AI: ${savedCalls} | Scored: ${totals.scored} | Alerted: ${totals.alerted}`);

  return summaries;
}