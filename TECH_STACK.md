# Tech Stack and Environment

## Runtime Environment
*   **Node.js**: v22.21.1 (Managed via nvm)
*   **NPM**: Used for package management.

## Key Libraries
*   `@google/generative-ai`: For interfacing with the Gemini AI.
*   `better-sqlite3`: For the local opportunity database.
*   `slack-sdk`: For sending Slack notifications.
*   `axios`: For making HTTP requests to the SAM.gov API.

## External Dependencies
*   **`pdftotext` (poppler)**: Required for extracting text from PDF attachments. Must be installed on the system where the bot runs.
    *   Installation (macOS via Homebrew): `brew install poppler`
*   **`docx2txt`**: Required for extracting text from DOCX attachments. Must be installed on the system where the bot runs.
    *   Installation (macOS via Homebrew): `brew install docx2txt`

## Environment Configuration
*   **`.env` file**: Stores all necessary secrets and environment variables, including:
    *   `SAM_API_KEY`
    *   `GEMINI_API_KEY`
    *   `SLACK_BOT_TOKEN_*` (for different Slack workspaces)
    *   `SLACK_CHANNEL_ID_*`
*   **GitHub Secrets**: The production environment running via GitHub Actions requires the same variables to be configured as repository secrets.

## Memory Management
*   Due to high memory consumption when processing large datasets, the application must be run with the `--expose-gc` flag to allow for explicit garbage collection.
    *   Example: `node --expose-gc bot/cli.js run`
