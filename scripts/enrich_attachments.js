// Re-enrich top opportunities with attachment text, then rescore with AI.
// This is a one-time script to backfill attachment data after enabling fetch_attachments.

import { createLogger } from "../bot/logger.js";
import { fetchAttachmentText } from "../bot/enrich.js";
import { scoreWithAi } from "../bot/ai.js";
import { deterministicScore, blendScores } from "../bot/scoring.js";
import { checkEligibility } from "../bot/eligibility.js";
import { initStorage, saveScore } from "../bot/storage.js";
import { loadConfig } from "../bot/config.js";
import "dotenv/config";

const logger = createLogger({ verbose: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const samApiKey = process.env.SAM_API_KEY;
  if (!geminiApiKey || !samApiKey) {
    console.error("GEMINI_API_KEY and SAM_API_KEY required in .env");
    return;
  }

  const { config } = loadConfig();
  const profile = config.profiles[0];
  const db = await initStorage(config.storage.sqlite_path);

  // Get top scored opportunities that have empty attachment_text
  const opps = await new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM opportunities
       WHERE last_score >= 50
         AND last_scored_at IS NOT NULL
         AND (response_deadline IS NULL OR response_deadline >= date('now'))
         AND (attachment_text IS NULL OR attachment_text = '')
       ORDER BY last_score DESC
       LIMIT 25`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  logger.info(`Found ${opps.length} top opportunities missing attachment text.`);
  if (opps.length === 0) return;

  let enriched = 0;
  let scored = 0;

  for (const opp of opps) {
    const normalized = {
      noticeId: opp.notice_id,
      solicitationNumber: opp.solicitation_number,
      title: opp.title,
      agencyPath: opp.agency,
      postedDate: opp.posted_date,
      responseDeadline: opp.response_deadline,
      naicsCode: opp.naics_code,
      setAside: opp.set_aside,
      classificationCode: opp.classification_code,
      uiLink: opp.ui_link,
    };

    // Restore resourceLinks from data_json
    try {
      const data = JSON.parse(opp.data_json || "{}");
      normalized.resourceLinks = data.resourceLinks || [];
    } catch (_) {
      normalized.resourceLinks = [];
    }

    logger.info(
      `[${enriched + 1}/${opps.length}] ${opp.title?.substring(0, 60)} — ${normalized.resourceLinks.length} resource links`
    );

    if (normalized.resourceLinks.length === 0) {
      logger.info("  -> No resource links, skipping");
      continue;
    }

    // Fetch attachment text
    const attachmentText = await fetchAttachmentText({
      opportunity: normalized,
      apiKey: samApiKey,
      fetchImpl: fetch,
      logger,
    });

    if (!attachmentText) {
      logger.info("  -> No attachment text extracted");
      continue;
    }

    logger.info(`  -> Fetched ${attachmentText.length} chars of attachment text`);

    // Save attachment text to DB
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE opportunities SET attachment_text = ? WHERE notice_id = ?`,
        [attachmentText, opp.notice_id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    enriched++;

    // Now rescore with AI using the new attachment text
    const descriptionText = opp.description_text || "";

    const eligibility = checkEligibility(
      normalized,
      descriptionText,
      profile.company_eligibility ?? {}
    );

    if (!eligibility.isEligible) {
      logger.info("  -> Disqualified by eligibility");
      continue;
    }

    const configKeywords =
      profile.scoring.positive_keywords || profile.scoring.negative_keywords
        ? {
            positive: profile.scoring.positive_keywords,
            negative: profile.scoring.negative_keywords,
          }
        : undefined;
    const pre = deterministicScore(normalized, descriptionText, configKeywords);

    const thresholds = {
      minGood: profile.scoring.min_good_fit_score ?? 75,
      minMaybe: profile.scoring.min_maybe_score ?? 55,
    };

    const aiScore = await scoreWithAi({
      apiKey: geminiApiKey,
      model: profile.scoring.ai_model,
      opportunity: normalized,
      descriptionText,
      attachmentText,
      companyProfile: profile.company_profile,
      logger,
    });

    const finalScore = blendScores(pre, aiScore, eligibility, thresholds);

    if (finalScore) {
      await saveScore(db, opp.notice_id, finalScore, new Date().toISOString());
      scored++;
      logger.info(
        `  -> ${finalScore.fit_label} (${finalScore.fit_score}) — ${finalScore.plain_english_summary?.slice(0, 80) || ""}`
      );
    }

    await sleep(2000);
  }

  logger.info(
    `\nDone: ${enriched} attachments fetched, ${scored} re-scored out of ${opps.length}.`
  );

  // Sync to Supabase
  logger.info("Syncing to Supabase...");
  const { syncTopOpportunities } = await import("../bot/sync_opportunities.js");
  await syncTopOpportunities(db, { verbose: true, logger });
}

main();
