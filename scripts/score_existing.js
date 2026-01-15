import { loadConfig } from "../bot/config.js";
import { createLogger } from "../bot/logger.js";
import { initStorage, listOpportunities, saveScore } from "../bot/storage.js";
import { scoreWithAi } from "../bot/ai.js";
import dotenv from "dotenv";
dotenv.config();

async function scoreExisting() {
  const { config } = loadConfig();
  const logger = createLogger({ verbose: true });

  const aiEnabled = config.scoring?.ai_enabled ?? true;
  if (!aiEnabled) {
    logger.info("AI scoring is disabled in the configuration.");
    return;
  }

  const aiModel = config.scoring?.ai_model ?? "models/gemini-pro";
  const aiKey = process.env.GEMINI_API_KEY;

  if (!aiKey) {
    logger.error("GEMINI_API_KEY not set; AI scoring disabled.");
    return;
  }

  const db = await initStorage(config.storage.sqlite_path);
  const opportunities = await listOpportunities(db, { 
    naicsCodes: config.sam.filters.naics, 
    keywords: config.sam.filters.keywords 
  });

  logger.info(`Found ${opportunities.length} opportunities in the database matching the new criteria.`);

  let scoredCount = 0;
  for (const opp of opportunities) {
    // A confidence of 0.4 is the fallback score when AI fails.
    if (opp.last_confidence !== 0.4) {
      continue;
    }

    logger.info(`Scoring opportunity: ${opp.notice_id}`);

    const aiScore = await scoreWithAi({
      apiKey: aiKey,
      model: aiModel,
      opportunity: JSON.parse(opp.data_json),
      descriptionText: opp.description_text,
      logger,
    });

    if (aiScore) {
      await saveScore(db, opp.notice_id, aiScore, new Date().toISOString());
      logger.info(`Successfully scored opportunity: ${opp.notice_id}`);
      scoredCount++;
    }
  }

  logger.info(`Scored ${scoredCount} new opportunities.`);
}

scoreExisting();
