import fs from 'fs';
import path from 'path';

// Manually read and parse the .env file
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envFileContent = fs.readFileSync(envPath, 'utf-8');
  const envConfig = envFileContent.split('\n').reduce((acc, line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      acc[key.trim()] = value.trim();
    }
    return acc;
  }, {});

  // Set the environment variables
  for (const key in envConfig) {
    process.env[key] = envConfig[key];
  }
}

import { loadConfig } from "../bot/config.js";
import { createLogger } from "../bot/logger.js";
import { initStorage, listOpportunities } from "../bot/storage.js";
import { buildSlackPayload, postSlackMessage } from "../bot/slack.js";

import fetch from "node-fetch";

async function postGoodFitToSlack() {
  const [slackBotToken, slackChannel] = process.argv.slice(2);

  if (!slackBotToken || !slackChannel) {
    console.error("Usage: node scripts/post_good_fit_to_slack.js <slack_bot_token> <slack_channel>");
    return;
  }

  const { config } = loadConfig();
  const logger = createLogger({ verbose: true });

  const db = await initStorage(config.storage.sqlite_path);
  const allOpportunities = await listOpportunities(db);
  const goodFitOpportunities = allOpportunities.filter(
    (opp) => opp.last_fit_label === "GOOD_FIT"
  );

  logger.info(`Found ${goodFitOpportunities.length} GOOD_FIT opportunities to post.`);

  for (const opp of goodFitOpportunities) {
    const score = {
      fit_label: opp.last_fit_label,
      fit_score: opp.last_score,
      confidence: opp.last_confidence,
      reasons: [], // Note: reasons are not stored in the DB, so this will be empty
      risks: [], // Note: risks are not stored in the DB, so this will be empty
    };
    const payload = buildSlackPayload({ opportunity: JSON.parse(opp.data_json), score });
    
    logger.info(`Posting opportunity to Slack: ${opp.title}`);
    await postSlackMessage({ token: slackBotToken, channel: slackChannel, payload, fetchImpl: fetch });
  }

  logger.info("Done posting GOOD_FIT opportunities to Slack.");
}

postGoodFitToSlack();