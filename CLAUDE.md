# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Provision-FedWatch is a Node.js CLI tool that scans SAM.gov for federal contracting opportunities, scores them using a hybrid deterministic + AI system, and sends alerts to Slack. It targets all industries (not just IT) looking for opportunities where technology/automation creates competitive advantages. The company is an SDVOSB (Service-Disabled Veteran-Owned Small Business).

## Commands

```bash
# Run the scanner
npm run bot:run                    # Live run with --expose-gc
npm run bot:dry-run                # Test run, no Slack posting
npm run bot:backfill               # Backfill 7 days of history

# CLI with options
node bot/cli.js run --dry-run --verbose
node bot/cli.js run --profiles "Tech-Enhanced Market Opportunities"
node bot/cli.js backfill --days 14

# Intelligence/query commands (read-only, no API calls)
node bot/cli.js query --min-score 50 --agency DOD --limit 10
node bot/cli.js show <notice_id>
node bot/cli.js compare <id1> <id2>
node bot/cli.js pipeline
node bot/cli.js stats --group-by agency

# Lifecycle management
node bot/cli.js status <notice_id> <status>
node bot/cli.js note <notice_id> "some note"
node bot/cli.js tag <notice_id> capability "cloud migration"
node bot/cli.js outcome <notice_id> --result won --amount 150000

# Tests
npm test                           # Node.js built-in test runner (node --test)
node --test test/intelligence.test.js  # Run a single test file
SAM_FIXTURE_PATH=test/fixtures/sam.json npm run bot:dry-run  # Run with fixtures, no API calls
```

## Architecture

**ES Modules project** (`"type": "module"` in package.json). No build step; runs directly with Node.js v22+ (managed via nvm).

### Scoring Pipeline

The scoring pipeline has three stages with an eligibility pre-gate:

```
cli.js → runner.js (orchestration, iterates profiles)
  → sam_client.js (fetch from SAM.gov API, pagination, fixture mode)
  → normalizer.js (normalize API response)
  → enrich.js (fetch descriptions, parse PDF/DOCX attachments)
  → eligibility.js (pre-AI gate: 8(a), clearance, sole source checks)
      ↳ disqualifying → score 0, skip AI call
      ↳ warnings → passed through as penalty to blendScores
  → scoring.js deterministicScore() (base 50, +5 per positive keyword, -15 per negative)
  → ai.js scoreWithAi() (Google Gemini via @google/generative-ai SDK)
  → scoring.js blendScores() (30% deterministic + 70% AI, -15 per eligibility warning, cap AI at 40 if deterministic < 25)
  → storage.js (SQLite upsert with dedup via content hash)
  → slack.js (Block Kit alert if shouldAlert() passes)
```

### Key Modules

- **`bot/runner.js`** — Main orchestration. Multi-profile: iterates `config.profiles[]`, returns `summaries[]` (array of per-profile summary objects). Processes opportunities in batches of 10 with 2s delays and optional GC. Caps description fetches per run (`max_descriptions_per_run`).
- **`bot/storage.js`** — SQLite wrapper. Schema auto-migrates using `safeAddColumn()`. All DB operations are promise-wrapped callbacks over the `sqlite3` driver. Also contains query/stats functions used by intelligence.js.
- **`bot/scoring.js`** — `deterministicScore()` accepts optional `{ positive, negative }` keywords from config profile, falls back to hardcoded lists. `blendScores()` merges deterministic + AI + eligibility penalties. `shouldAlert()` checks hash-based deduplication.
- **`bot/ai.js`** — Google Gemini integration via `@google/generative-ai` SDK (not OpenAI-style fetch). Retries on 429/5xx with exponential backoff. Returns null on non-retryable errors (deterministic fallback used). `buildPrompt()` is profile-agnostic — the `company_profile` text steers AI scoring direction.
- **`bot/eligibility.js`** — Pre-AI eligibility gate. Checks 8(a) set-aside mismatch, security clearance requirements, and sole-source patterns. Returns `{ isEligible, issues[] }` with severity `disqualifying` or `warning`.
- **`bot/intelligence.js`** — CLI query interface for the local SQLite database. Handles `query`, `show`, `compare`, `pipeline`, `stats`, and lifecycle commands. Uses ANSI color codes for terminal formatting.
- **`bot/enrich.js`** — Fetches description text from SAM.gov API (clamped to 16K chars) and parses PDF/DOCX attachments (clamped to 32K chars). Requires `poppler` and `docx2txt` system tools via Homebrew.
- **`bot/sam_client.js`** — SAM.gov API client with retry logic, pagination, multiple NAICS code support, and fixture mode via `SAM_FIXTURE_PATH`.

### Configuration

`config/opportunity-bot.json` has a `profiles[]` array (each profile has its own SAM filters, scoring keywords/thresholds, and Slack channel). Current profiles:

1. **Tech-Enhanced Market Opportunities** (primary) — All industries, $25K–$5M, GOOD_FIT ≥70 / MAYBE ≥45
2. **High-Value IT (PIVOT-type)** — IT/cyber/fraud/AI focus, $100K–$50M, GOOD_FIT ≥70 / MAYBE ≥50
3. **COTS/SaaS Integration** — SaaS/FedRAMP/managed services, $50K–$25M, GOOD_FIT ≥60 / MAYBE ≥40
4. **Facilities & Logistics (NJ/NY/PA)** — Janitorial/grounds/warehouse/logistics, $25K–$5M, GOOD_FIT ≥65 / MAYBE ≥40

Set-asides: SDVOSBC, SDVOSBS, SBA, SBP, 8A, 8AN. Select profiles at runtime with `--profiles`.

### Database

SQLite at `.data/opportunity_bot.sqlite` (auto-created). Key tables:
- **opportunities** — Primary table with scoring fields (`last_score`, `last_fit_label`, `hash`), AI analysis fields (`ai_summary`, `ai_reasons_json`, etc.), and lifecycle fields (`pursuit_status`, `priority`, `notes`)
- **alerts** — Deduplication tracking for Slack alerts
- **pursuit_events** — Append-only event log for status changes
- **outcomes** — Win/loss records with debrief data
- **tags** — Flexible categorization (categories: capability, technology, industry, strategy, custom)

Pursuit statuses: `discovered → reviewing → interested → pursuing → submitted → won/lost/no_bid/expired`

### Deduplication

Content hash built from opportunity fields + first 4000 chars of description/attachment text. If hash matches and opportunity was already scored, it's skipped. Alert hash prevents duplicate Slack messages.

### Testing Patterns

Tests use Node.js built-in test runner (`node:test` + `node:assert/strict`). Key patterns:
- **Mock fetch**: `buildMockFetch(routes)` with route matching and `jsonResponse()`/`textResponse()` helpers (in `test/opportunity_bot.test.js`)
- **Temp databases**: Tests create isolated SQLite DBs (e.g., `.data/test-intelligence.sqlite`) and clean up before/after
- **Factory functions**: `makeOpp()` for creating test opportunity objects with overrides
- **Fixture config**: `test/fixtures/opportunity-bot.json` and `test/fixtures/opportunity-bot-cap.json` — must use `profiles[]` wrapper format matching production config structure
- **Dependency injection**: Modules accept `fetchImpl` and `logger` parameters for testability
- **`runOpportunityBot()` returns an array** of per-profile summary objects, not a single summary

## Environment Variables

```bash
SAM_API_KEY                    # SAM.gov API access
GEMINI_API_KEY                 # Google Gemini (default AI provider)
SLACK_BOT_TOKEN                # Primary Slack workspace
SLACK_BOT_TOKEN_PROVISIONS     # Alternative workspace
SLACK_BOT_TOKEN_STATUS         # Status notifications
AI_PROVIDER                    # "gemini" (default) or "openai"
OPENAI_API_KEY                 # Required if AI_PROVIDER=openai
SAM_FIXTURE_PATH               # Path to fixture JSON for testing without API calls
```

## Development Constraints

- **Business isolation**: This workspace is exclusively for ProVision Systems (Software/FedWatch). Do not use context from Woody's Remodeling (Construction).
- **Memory safety**: Use streams (`fs.createReadStream`) for large files. Run with `--max-old-space-size=4096` for heavy ingestion.
- **Error logging**: Log full error objects: `console.error("[opportunity-bot] Fatal error:", error)`
- **Fit-rating priority**: Scoring logic must prioritize NAICS 541511 and 541512.
- **System dependencies**: `poppler` (PDF extraction) and `docx2txt` (DOCX extraction) via Homebrew on macOS.
