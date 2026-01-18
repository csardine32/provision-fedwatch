# Session Log

## Session 1: Bot Re-alignment and Gemini Integration
*   Re-configured the bot for "RMC Integration Services LLC".
*   Migrated the AI scoring engine from OpenAI to Google's Gemini.
*   Integrated Slack alerts for "Provisions Unlimited".
*   Set up initial cron job scheduling scripts.

## Session 2: API Quota Tuning and Filter Analysis
*   Configured a new, fully registered SAM.gov API key.
*   Diagnosed API quota issues, confirming the new key was working but the daily quota was likely exhausted.
*   Analyzed "GOOD_FIT" scoring results to understand the AI's reasoning.

## Session 3: Multi-Profile Refactoring and GitHub Actions Setup
*   Refactored the bot to support multiple company profiles from a single configuration file.
*   Added a profile for "Provisions Unlimited" with its own filters and Slack integration.
*   Created a GitHub Actions workflow for reliable, scheduled bot runs.
*   Debugged and resolved an issue with loading local `.env` variables.

## Session 4: Advanced AI Prompt and Memory Crash
*   Developed a new, sophisticated "Contract Analyst" AI prompt to generate richer analysis (summary, skillsets, key dates).
*   Redesigned Slack notifications to display the new, detailed information.
*   Identified and fixed a circular dependency.
*   Encountered a critical "JavaScript heap out of memory" error, identifying it as the new primary blocker.

## Session 5: Attachment Processing and Memory Management
*   Implemented PDF attachment processing using the `pdftotext` utility.
*   Updated the database schema and application code to handle and store extracted attachment text.
*   Addressed the memory leak by implementing batch processing for opportunities, with explicit garbage collection and a delay between batches.

## Session 6: Final Attachment Test and Memory Crash
*   Completed the final implementation for handling PDF attachments, including code updates to `bot/enrich.js`, `bot/runner.js`, `bot/scoring.js`, and `bot/storage.js`.
*   Installed the `poppler` dependency (containing `pdftotext`) via Homebrew.
*   Committed and pushed the attachment processing feature to the `main` branch.
*   A test run after these changes again resulted in a critical "JavaScript heap out of memory" error, confirming a persistent memory leak issue.

## Session 7: Stability and Phase 2 Implementation

*   **Resolved Hang/Crash:** After a lengthy debugging process, a persistent hang-on-startup was traced to an issue with the `sqlite3` native module. Rebuilding the module and then fixing a subsequent logic error in the database skipping condition stabilized the application.
*   **Memory Leak Fixed:** Resolved a critical "JavaScript heap out of memory" error by reducing the size of the JSON object being stored in the database.
*   **Phase 2 Implementation:** Integrated the full logic for Phase 2 (Attachment Handling). The bot can now:
    *   Identify attachment links from opportunity data.
    *   Download the linked files.
    *   Extract text from `.pdf` and `.txt` files.
    *   Pass the extracted text to the AI for analysis.
*   **Identified Next Task:** Diagnosed a new issue where the AI does not appear to be using the extracted attachment text in its analysis, representing the next focus for development.
*   **Versioning Strategy:** Implemented a `git tag` based system to save and revert to known "functional versions" of the bot.
