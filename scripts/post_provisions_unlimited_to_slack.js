
import { createLogger } from "../bot/logger.js";
import { initStorage } from "../bot/storage.js";
import { loadConfig } from "../bot/config.js";
import { buildSlackPayload, postSlackMessage } from "../bot/slack.js";
import "dotenv/config";

const logger = createLogger({ verbose: true });

  console.log('Debugging SLACK_BOT_TOKEN_PROVISIONS:', process.env.SLACK_BOT_TOKEN_PROVISIONS);

async function main() {
    console.log('Debugging SLACK_BOT_TOKEN_PROVISIONS:', process.env.SLACK_BOT_TOKEN_PROVISIONS);
  
    // Explicitly load .env if not already loaded
    if (!process.env.SLACK_BOT_TOKEN_PROVISIONS && fs.existsSync(".env")) {
      const dotenv = require('dotenv');
      const envConfig = dotenv.parse(fs.readFileSync(".env"));
      for (const k in envConfig) {
        process.env[k] = envConfig[k];
      }
      console.log('Debugging SLACK_BOT_TOKEN_PROVISIONS (after explicit load):', process.env.SLACK_BOT_TOKEN_PROVISIONS);
    }
  
    const { config } = loadConfig();
  const profile = config.profiles.find(p => p.name === "Provisions Unlimited");
  if (!profile) {
    console.error("Provisions Unlimited profile not found in config.");
    return;
  }

  const slackBotToken = process.env.SLACK_BOT_TOKEN_PROVISIONS;
  if (!slackBotToken) {
    console.error("SLACK_BOT_TOKEN_PROVISIONS not found in .env file.");
    return;
  }

  const db = await initStorage(config.storage.sqlite_path);
  const opportunities = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM opportunities WHERE last_fit_label = 'GOOD_FIT'", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  logger.info(`Found ${opportunities.length} GOOD_FIT opportunities to post for ${profile.name}.`);

  for (const opp of opportunities) {
    const normalized = JSON.parse(opp.data_json);
    const score = {
        fit_label: opp.last_fit_label,
        fit_score: opp.last_score,
        reasons: [], // Not available in the DB, but the payload builder can handle it
        risks: []
    };

    const payload = buildSlackPayload({ opportunity: normalized, score });

    logger.info(`--- Posting opportunity: ${normalized.title} (${normalized.noticeId}) to ${profile.slack.channel} ---`);
    
    await postSlackMessage({
      token: slackBotToken,
      channel: profile.slack.channel,
      payload
    });
  }

  logger.info("Posting complete.");
}

main();
