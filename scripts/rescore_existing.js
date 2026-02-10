
import { createLogger } from "../bot/logger.js";
import { scoreWithAi } from "../bot/ai.js";
import { deterministicScore, blendScores, scoreToLabel } from "../bot/scoring.js";
import { checkEligibility } from "../bot/eligibility.js";
import { initStorage, saveScore } from "../bot/storage.js";
import { loadConfig } from "../bot/config.js";
import "dotenv/config";

const logger = createLogger({ verbose: true });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.error("GEMINI_API_KEY not found in .env file.");
    return;
  }

  const { config } = loadConfig();
  const profile = config.profiles[0];
  if (!profile) {
    console.error("No profile found in config.");
    return;
  }

  const db = await initStorage(config.storage.sqlite_path);

  // Only rescore opportunities missing AI analysis data
  const opportunities = await new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM opportunities WHERE ai_summary IS NULL AND last_scored_at IS NOT NULL ORDER BY last_score DESC",
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });

  logger.info(`Found ${opportunities.length} opportunities missing AI analysis data.`);
  if (opportunities.length === 0) {
    logger.info("Nothing to rescore — all opportunities already have AI analysis.");
    return;
  }

  let scored = 0;
  let failed = 0;

  for (const opp of opportunities) {
    // Rebuild normalized opportunity from DB columns
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

    // Restore contacts/links from data_json
    try {
      const data = JSON.parse(opp.data_json || "{}");
      normalized.pointOfContact = data.pointOfContact || [];
      normalized.resourceLinks = data.resourceLinks || [];
    } catch (_) {}

    logger.info(`[${scored + failed + 1}/${opportunities.length}] Scoring: ${opp.title} (${opp.notice_id})`);

    const descriptionText = opp.description_text || "";
    const attachmentText = opp.attachment_text || "";

    // Eligibility check
    const eligibility = checkEligibility(
      normalized,
      descriptionText,
      profile.company_eligibility ?? {},
    );

    if (!eligibility.isEligible) {
      const reasons = eligibility.issues.filter((i) => i.severity === "disqualifying").map((i) => i.message);
      const disqualifiedScore = {
        is_relevant: false,
        plain_english_summary: "Auto-disqualified by eligibility gate.",
        required_skillsets: [],
        fit_label: "NOT_A_FIT",
        fit_score: 0,
        reasons,
        risks: reasons,
        key_dates: { due_date: "", other_dates: [] },
        attachment_summary: "",
        must_check_items: [],
      };
      await saveScore(db, opp.notice_id, disqualifiedScore, new Date().toISOString());
      scored++;
      logger.info(`  -> ❌ DISQUALIFIED — ${reasons.join("; ")}`);
      continue;
    }

    // Deterministic scoring with config keywords
    const configKeywords = (profile.scoring.positive_keywords || profile.scoring.negative_keywords)
      ? { positive: profile.scoring.positive_keywords, negative: profile.scoring.negative_keywords }
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
      const label = finalScore.fit_label;
      const symbol = label === "GOOD_FIT" ? "✅" : label === "MAYBE" ? "🟡" : "❌";
      logger.info(`  -> ${symbol} ${label} (${finalScore.fit_score}) — ${finalScore.plain_english_summary?.slice(0, 80) || ""}...`);
    } else {
      failed++;
      logger.warn(`  -> Failed to score.`);
    }

    // Rate limit: pause between API calls
    await sleep(2000);
  }

  logger.info(`\nRescore complete: ${scored} scored, ${failed} failed out of ${opportunities.length}.`);
}

main();
