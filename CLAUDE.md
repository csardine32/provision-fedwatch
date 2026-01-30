# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Provision-FedWatch is a Node.js automated system that monitors federal contracting opportunities on SAM.gov, scores them for relevance against company profiles, and sends alerts to Slack. It supports multiple company profiles from a single configuration and uses hybrid scoring (deterministic + optional AI via Google Gemini).

## Common Development Commands

### Bot Operations
```bash
# Development and testing
npm run bot:dry-run                              # Safe test run without Slack posting
npm run bot:run                                  # Live execution with garbage collection
npm run bot:backfill                             # Backfill 7 days of historical data

# CLI variants with options
node bot/cli.js run --dry-run --verbose          # Verbose dry run for debugging
node bot/cli.js run --profiles "Profile1,Profile2"  # Run specific profiles only
node bot/cli.js backfill --days N                # Backfill N days of history
node bot/cli.js run --config <path>              # Use custom config file
```

### Testing
```bash
npm test                                         # Run Node.js built-in test suite
SAM_FIXTURE_PATH=test/fixtures/sam.json npm run bot:dry-run  # Test with fixtures (no API calls)
./scripts/smoke_scorer.sh                        # Quick validation test
```

### System Requirements
- **Node.js**: v18+ required (uses ES modules)
- **External Tools**:
  - `poppler` for PDF extraction (`brew install poppler` on macOS)
  - `docx2txt` for DOCX extraction (`brew install docx2txt` on macOS)

## Architecture Overview

### Core Data Flow
```
CLI Entry → Load Config → For Each Profile:
  SAM.gov API → Normalize → Store → Enrich (PDFs/DOCXs) → Score → Alert → Slack
```

### Key Components
- **`bot/cli.js`**: Command-line entry point with argument parsing
- **`bot/runner.js`**: Main orchestration logic that iterates through profiles
- **`bot/sam_client.js`**: SAM.gov API client with pagination and quota management
- **`bot/storage.js`**: SQLite wrapper for opportunity tracking and deduplication
- **`bot/scoring.js`**: Hybrid scoring system (deterministic + AI)
- **`bot/ai.js`**: Google Gemini integration with retry logic
- **`bot/slack.js`**: Slack Block Kit message formatting and posting
- **`bot/enrich.js`**: Document processing for PDF/DOCX text extraction

### Configuration Structure
All configuration lives in `config/opportunity-bot.json` with profile-based structure:
- **Profiles**: Multiple company profiles with independent settings
- **SAM Filters**: NAICS codes, keywords, set-aside codes, lookback periods
- **Scoring**: Thresholds, keyword lists, AI model configuration
- **Alerting**: Slack channels, posting rules, alert caps
- **Storage**: SQLite database path

### Scoring System
1. **Deterministic Base**: Start at 50, +5 per positive keyword, -10 per negative keyword
2. **AI Enhancement**: Optional Google Gemini scoring with structured JSON response
3. **Thresholds**: GOOD_FIT (≥75), MAYBE (55-74), NOT_A_FIT (<55) - configurable per profile
4. **Deduplication**: Hash-based tracking to avoid duplicate alerts on unchanged opportunities

## Environment Variables
Required runtime environment variables:
```bash
SAM_API_KEY                    # SAM.gov API key
GEMINI_API_KEY                 # Google Generative AI key (if AI enabled)
SLACK_BOT_TOKEN                # Primary Slack bot token
SLACK_BOT_TOKEN_PROVISIONS     # Alternative workspace token
SLACK_BOT_TOKEN_STATUS         # Status notification token
```

## Database Schema
SQLite database auto-created at `./.data/opportunity_bot.sqlite`:
- **opportunities**: Core opportunity data with normalization
- **scores**: Tracking of scoring history and AI responses
- **alerts**: Deduplication hashes to prevent duplicate notifications

## Memory Management
The application processes large datasets and requires:
- `--expose-gc` flag for manual garbage collection
- Batch processing (10 items per batch) with GC between batches
- 2-second delays between batches to prevent memory pressure

## Testing Strategy
- **Unit Tests**: Node.js built-in `node:test` framework in `test/opportunity_bot.test.js`
- **Mock Testing**: Custom `buildMockFetch()` for SAM.gov API responses
- **Fixture Mode**: `SAM_FIXTURE_PATH` environment variable for local testing without API calls
- **Smoke Tests**: `./scripts/smoke_scorer.sh` for quick validation

## Slack Integration
Uses Block Kit API with modular sections:
- AI-generated summaries (truncated to 2500 chars to respect Slack limits)
- Structured opportunity details (agency, solicitation #, due date)
- Attachment summaries and skillset analysis
- Risk assessment and must-check items
- Direct links to SAM.gov and attachments

## AI Integration
Google Gemini provides structured scoring with fallback to deterministic:
- **Input**: Company profile + opportunity details + enriched content
- **Output**: JSON with fit_score, fit_label, plain_english_summary, skillsets, risks
- **Reliability**: Retry logic for 429/5xx errors with exponential backoff
- **Validation**: Schema validation against expected JSON structure

## Deployment
- **GitHub Actions**: Twice-daily scheduled runs via workflow_dispatch
- **Idempotency**: Hash-based deduplication ensures clean restarts
- **Multi-Profile**: Single execution processes all configured profiles
- **State Tracking**: SQLite persistence for cross-run continuity