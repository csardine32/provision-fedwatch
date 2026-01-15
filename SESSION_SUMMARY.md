# Session Summary: Bot Re-alignment and Gemini Integration

This document summarizes the key accomplishments and changes made during our interactive session.

## 1. Bot Re-alignment for RMC Integration Services LLC

The bot has been re-configured to align with the business focus of "RMC Integration Services LLC". This involved:

*   **Company Profile**: The AI model's prompt now uses the RMC company profile.
*   **Filtering**: The `config/opportunity-bot.json` file has been updated with new NAICS codes and keywords relevant to RMC's services (IT, telecommunications, staffing).
*   **Scoring**: The deterministic scoring logic in `bot/scoring.js` has been updated with new keywords.

## 2. Gemini AI Integration

The AI scoring engine has been migrated from OpenAI to Google's Gemini.

*   **Gemini SDK**: The `@google/generative-ai` SDK has been integrated into `bot/ai.js`.
*   **Retry Mechanism**: A retry mechanism with exponential backoff has been implemented to handle API rate limiting from the Gemini API.

## 3. Slack Integration for "Provisions Unlimited"

The bot is now configured to send alerts to a new paid Slack workspace for "Provisions Unlimited".

*   **Configuration**: The `.env` file and `config/opportunity-bot.json` have been updated with the new Slack bot token and channel (`#rmc-opportunities`).
*   **Posting Script**: A new script `scripts/post_good_fit_to_slack.js` has been created to post existing "GOOD_FIT" opportunities to the Slack channel.

## 4. Scheduling

A scheduling mechanism has been set up to run the bot automatically.

*   **Cron Job Script**: A new script `worker/run_bot.sh` has been created to ensure the environment variables are loaded correctly and to run the bot's main process.
*   **Crontab Entry**: Instructions have been provided to set up a cron job to run the bot twice a day (9:05 AM and 4:05 PM EST).

## 5. Identified Blockers

*   **SAM.gov API Quota**: We consistently encountered rate limiting issues with the SAM.gov API, which prevented us from fetching new opportunities reliably. This is the main blocker for end-to-end testing and production use.

## 6. Next Steps

*   **Wait for SAM.gov API quota to reset** to test the full end-to-end functionality of the bot.
*   **Monitor the cron job** to ensure it runs as expected.
*   **Consider upgrading the SAM.gov API key** to a higher tier to avoid quota issues.

---

# Session Summary 2: API Quota Tuning and Filter Analysis

This session focused on resolving the SAM.gov API quota issues and refining the opportunity fetching process.

## 1. New SAM.gov API Key

*   A new, fully registered SAM.gov API key for "Provisions Unlimited" was provided and configured in the `.env` file to replace the previous key.

## 2. Filter and Quota Investigation

A series of tests were run to diagnose why no opportunities were being fetched.

*   **Filter Logic:** Confirmed that the bot searches for opportunities that match **both** a NAICS code **and** a keyword.
*   **Unfiltered Fetch:** A test with all filters removed successfully fetched over 2000 opportunities, proving the new API key and core fetching mechanism are working. These opportunities were loaded into the local database and scored.
*   **Persistent Quota Issues:** Despite the new key, tests with filters enabled and a lookback period greater than 1 day consistently failed due to "Quota exceeded" errors.
*   **Hypothesis:** The current working hypothesis is that the daily API quota has been exhausted and that we need to wait for it to reset.

## 3. Scoring Analysis

*   Investigated why two opportunities were rated "GOOD_FIT".
*   A temporary script was created to re-run the AI scoring for these opportunities.
*   **Reasoning:** The analysis revealed they were a strong match because they were for the GSA Multiple Award Schedule (MAS), a primary government contract vehicle, and their NAICS code (541519) perfectly matched RMC's profile.

## 4. Next Steps

*   **Wait for SAM.gov API quota to reset.**
*   **Test with a specific configuration:** The bot is now configured to run a test with the following settings once the quota is presumed to be reset:
    *   `posted_lookback_days: 3`
    *   `max_pages_per_run: 10`
    *   NAICS filters enabled
    *   Keyword filters disabled

---

# Session Summary 3: Multi-Profile Refactoring and GitHub Actions Setup

This session focused on refactoring the bot to support multiple company profiles and setting up a reliable, always-on scheduling mechanism using GitHub Actions.

## 1. Multi-Profile Bot Refactoring

*   **Config Refactoring:** `config/opportunity-bot.json` was refactored to support an array of company profiles, each with its own `sam` configuration (filters, lookback, max pages), `scoring` parameters, `slack` details, and `alerting` preferences.
*   **AI Module Refactoring:** `bot/ai.js` was modified to accept a `company_profile` as a parameter for AI scoring, rather than using a hardcoded constant.
*   **Runner Module Refactoring:** `bot/runner.js` was refactored to loop through the configured profiles and execute the bot's logic independently for each.
*   **"Provisions Unlimited" Profile Added:** A new profile for "Provisions Unlimited" was added to `config/opportunity-bot.json`, including its specific NAICS codes and keywords derived from its Capabilities Statement. A dedicated Slack channel `#provisions-unlimited-opportunities` and a new `SLACK_BOT_TOKEN_PROVISIONS` environment variable were configured for this profile.

## 2. GitHub Actions Workflow for Scheduled Runs

*   A new GitHub Actions workflow `scheduled-run.yml` was created to automatically run the bot on a schedule (9:05 AM and 4:05 PM EST, converted to UTC `5 14,21 * * *`).
*   The workflow is configured to check out the repository, set up Node.js, install dependencies, run the bot, and send a Slack notification to a dedicated status channel (`#bot-status`) upon completion (success or failure).
*   **Required Secrets:** The user was instructed to add `SAM_API_KEY`, `GEMINI_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_BOT_TOKEN_PROVISIONS`, `SLACK_CHANNEL_ID_STATUS`, and `SLACK_BOT_TOKEN_STATUS` as repository secrets in GitHub.

## 3. Debugging and Resolution of Local .env Issue

*   During the testing of Slack posting for "Provisions Unlimited", an issue was encountered where `SLACK_BOT_TOKEN_PROVISIONS` was not being loaded from the local `.env` file.
*   **Root Cause:** It was discovered that the `.env` file contained duplicate `SLACK_BOT_TOKEN` entries, preventing the correct loading of `SLACK_BOT_TOKEN_PROVISIONS`. The user was instructed to use unique names for each token.
*   **Resolution:** The `.env` file was corrected by the user, and Slack posting for "Provisions Unlimited" was successfully demonstrated using a new `post-good-fits` CLI command (which was subsequently removed for codebase cleanliness).

## 4. Cron Job Management

*   It was determined that the user's local cron job was not initially set up. Instructions were provided for creating a new `crontab` entry for the scheduled bot run (9:05 AM and 4:05 PM EST).

## 5. Current Issue: GitHub Actions Workflow Visibility

*   The "Scheduled Bot Run" workflow is not visible in the user's GitHub Actions tab, despite the workflow file being pushed and the branch merged to the default branch. This could be due to GitHub UI caching or another subtle configuration issue.
