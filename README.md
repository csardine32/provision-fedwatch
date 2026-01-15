# Provision FedWatch (Service Account Mode)

- Secrets live in `config/keys/service.json` and are loaded via `config/keys/service.js`.
- API logic lives in `api/` with shared clients under `api/utils/`.
- Cron/worker entrypoints are in `worker/`.
- Supabase cron schedules sit in `config/supabase/config.toml`.

## Running locally
1) Install deps: `npm install openai node-fetch @supabase/supabase-js`.
2) Populate `config/keys/service.json` with your real values.
3) Run workers manually: `node worker/cron_fetcher.js`, `node worker/cron_scorer.js`, `node worker/cron_dispatcher.js`.

## Meta endpoint
- With the API running locally, curl `http://localhost:<port>/api/meta` to verify the service is up.
- Example response:
```json
{
  "appName": "ProVision Systems – Fed Watch",
  "environment": "development",
  "version": "dev",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## AI Collaboration
- AI workflow: ./AI_WORKFLOW.md
- PR checklist: ./PR_CHECKLIST.md

## Deploy
Use your serverless platform of choice (e.g., Supabase Edge Functions) and ensure `config/keys/service.json` is available at runtime or injected as secrets.

## AI Collaboration
- AI workflow: ./AI_WORKFLOW.md
- PR checklist: ./PR_CHECKLIST.md

## Smoke test
```bash
export SUPABASE_ANON_KEY=your_anon_key
export SUPABASE_PROJECT_REF=pzqeibaqlwmfglbiumjt
./scripts/smoke_scorer.sh
```

## CI Smoke Test
- GitHub Actions workflow: "Smoke Test – Scorer" runs on PRs and pushes to main.
- Add GitHub Secrets:
  - SUPABASE_ANON_KEY (required)
  - SUPABASE_PROJECT_REF (required)

## Opportunity Bot
- Config: `config/opportunity-bot.json`
- Docs: `docs/opportunity-bot.md`
- Run dry-run: `node bot/cli.js run --dry-run`
- Run live: `node bot/cli.js run`
