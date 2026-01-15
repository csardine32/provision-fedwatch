
import { createLogger } from "../bot/logger.js";
import { scoreWithAi } from "../bot/ai.js";
import { initStorage, saveScore } from "../bot/storage.js";
import { loadConfig } from "../bot/config.js";
import "dotenv/config";

const logger = createLogger({ verbose: true });

async function main() {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.error("GEMINI_API_KEY not found in .env file.");
    return;
  }

  const { config } = loadConfig();
  const profile = config.profiles.find(p => p.name === "Provisions Unlimited");
  if (!profile) {
    console.error("Provisions Unlimited profile not found in config.");
    return;
  }

  const db = await initStorage(config.storage.sqlite_path);
  const opportunities = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM opportunities", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  logger.info(`Found ${opportunities.length} opportunities in the database to re-score for ${profile.name}.`);

  for (const opp of opportunities) {
    const normalized = JSON.parse(opp.data_json);
    const descriptionText = opp.description_text;

    logger.info(`--- Scoring Opportunity: ${normalized.title} (${normalized.noticeId}) ---`);

    const score = await scoreWithAi({
      apiKey: geminiApiKey,
      model: profile.scoring.ai_model,
      opportunity: normalized,
      descriptionText,
      companyProfile: profile.company_profile,
      logger,
    });

    if (score) {
      await saveScore(db, normalized.noticeId, score, new Date().toISOString());
      if (score.fit_label === "GOOD_FIT" || score.fit_label === "MAYBE") {
        logger.info(`  -> New Score: ${score.fit_label} (${score.fit_score})`);
      }
    } else {
      logger.warn(`  -> Failed to score this opportunity.`);
    }
  }

  logger.info("Re-scoring complete.");
}

main();
