# Opportunity Bot

End-to-end pipeline for ingesting SAM.gov opportunities, scoring for fit, and posting Slack alerts.

## Quick start
1) Install deps: `npm install`
2) Copy `.env.example` to `.env` and fill in keys.
3) Review config: `config/opportunity-bot.json`
4) Run a dry run:
```
node bot/cli.js run --dry-run
```

## CLI
- Run now (live): `node bot/cli.js run`
- Dry run: `node bot/cli.js run --dry-run`
- Backfill: `node bot/cli.js backfill --days 7`
- Custom config: `node bot/cli.js run --config path/to/config.json`

## Fixture mode (no SAM.gov calls)
Set `SAM_FIXTURE_PATH` to a JSON file and the bot will load opportunities locally.

Example:
```
SAM_FIXTURE_PATH=test/fixtures/sam.json node bot/cli.js run --dry-run --verbose
```

## Scheduling (GitHub Actions)
Use the workflow in `.github/workflows/opportunity-bot.yml`.

Required secrets:
- `SAM_API_KEY`
- `SLACK_WEBHOOK_URL` (omit for dry-run jobs)
- `OPENAI_API_KEY` (optional if AI disabled)

Slack bot token alternative:
- `SLACK_BOT_TOKEN` and `SLACK_CHANNEL` (set in config as `slack.bot_token_env` + `slack.channel`)

## Storage & idempotency
The bot stores state in `./.data/opportunity_bot.sqlite` by default. It deduplicates alerts by
tracking a hash of key fields and only posts when new or materially changed.

## Configuration
`config/opportunity-bot.json` controls:
- SAM.gov filters and lookback window
- AI scoring thresholds and model
- Slack posting behavior
- SQLite storage path
