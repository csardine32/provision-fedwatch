# ProVision FedWatch

## Project Overview

This project, "ProVision FedWatch," is a Node.js application designed to monitor the System for Award Management (SAM.gov) for new federal government contract opportunities. It fetches opportunities, scores them based on configurable criteria, and sends alerts to a Slack channel for high-scoring opportunities. The project uses a combination of deterministic scoring and an optional AI-powered scoring mechanism (via OpenAI or Gemini). It maintains a local SQLite database to track processed opportunities and avoid duplicate alerts.

### Main Technologies

*   **Backend:** Node.js
*   **Database:** SQLite
*   **AI:** OpenAI, Google Gemini
*   **Notifications:** Slack
*   **Dependencies:**
    *   `@google/generative-ai`: For using the Gemini AI model.
    *   `dotenv`: For managing environment variables.
    *   `node-fetch`: For making HTTP requests to external APIs.
    *   `sqlite3`: For the local SQLite database.
    *   `pdf-parse`: For extracting text from PDF attachments.
    *   `word-extractor`: For extracting text from Word document attachments.

### Architecture

The project is structured into several modules:

*   **`bot/`**: Contains the core logic of the application.
    *   **`cli.js`**: The command-line interface for running the bot.
    *   **`runner.js`**: The main orchestration logic for fetching, scoring, and alerting on opportunities.
    *   **`sam_client.js`**: A client for interacting with the SAM.gov API.
    *   **`scoring.js`**: Implements the deterministic and AI-powered scoring logic.
    *   **`slack.js`**: Handles sending notifications to Slack.
    *   **`storage.js`**: Manages the SQLite database.
*   **`config/`**: Contains configuration files.
    *   **`opportunity-bot.json`**: The main configuration file for the bot, defining profiles, scoring criteria, and alert settings.
*   **`scripts/`**: Contains shell scripts for various tasks, such as running the bot and smoke tests.
*   **`supabase/`**: Contains Supabase-related configurations and functions.
*   **`test/`**: Contains tests for the application.

## Building and Running

### Prerequisites

*   Node.js and npm
*   A `.env` file with the necessary API keys and environment variables (see `.env.example`).

### Installation

```bash
npm install
```

### Running the Bot

The bot can be run in several modes:

*   **Live Run:**

    ```bash
    npm run bot:run
    ```

*   **Dry Run (no alerts will be sent):**

    ```bash
    npm run bot:dry-run
    ```

*   **Backfill (process opportunities from the last 7 days):**

    ```bash
    npm run bot:backfill
    ```

### Testing

Run the test suite with:

```bash
npm test
```

Run the smoke test with:

```bash
export SUPABASE_ANON_KEY=your_anon_key
export SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
./scripts/smoke_scorer.sh
```

## Development Conventions

*   The project uses ES modules (`"type": "module"` in `package.json`).
*   Code is organized into modules with specific responsibilities.
*   Configuration is managed through a JSON file (`config/opportunity-bot.json`) and environment variables.
*   The project uses `dotenv` to load environment variables from a `.env` file.
*   The project includes a suite of tests that can be run with `npm test`.
