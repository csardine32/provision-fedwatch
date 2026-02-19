#!/usr/bin/env node
import dotenv from "dotenv";
import { runOpportunityBot } from "./runner.js";
import { initStorage } from "./storage.js";
import { loadConfig } from "./config.js";
import {
  handleQuery,
  handleShow,
  handleCompare,
  handlePipeline,
  handleStatus,
  handleNote,
  handleTag,
  handleOutcome,
  handleStats,
} from "./intelligence.js";
import { handleDashboardSync } from "./dashboard_sync.js";
import { handleAlerts } from "./alerts.js";
import { handleSyncTop } from "./sync_opportunities.js";

dotenv.config();

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || "run";
  const flags = new Map();
  const positional = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "");
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
      flags.set(key, value);
      if (value !== true) i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

function printHelp() {
  console.log(`
Provision FedWatch CLI - Solicitation Intelligence

Usage: node bot/cli.js <command> [options]

Bot Commands:
  run                          Run the opportunity scanner
    --dry-run                  Safe test run without Slack posting
    --verbose                  Verbose output
    --config <path>            Use custom config file
    --profiles <names>         Comma-separated profile names
  backfill                     Backfill historical data
    --days <N>                 Number of days to backfill (default: 7)

Intelligence Commands:
  query                        Search and filter opportunities
    --min-score <N>            Minimum AI score
    --max-score <N>            Maximum AI score
    --set-aside <type>         Filter by set-aside (e.g., SDVOSB)
    --agency <name>            Filter by agency name
    --status <status>          Filter by pursuit status
    --naics <code>             Filter by NAICS code
    --keyword <term>           Search title/description/summary
    --label <label>            Filter by fit label (GOOD_FIT, MAYBE, NOT_A_FIT)
    --limit <N>                Max results (default: 25)
    --sort <column>            Sort by column (default: last_score)

  show <notice_id>             Full details for a single opportunity
  compare <id1> <id2> [...]    Side-by-side comparison

Lifecycle Commands:
  status <notice_id> <status>  Update pursuit status
    Valid statuses: discovered, reviewing, interested, pursuing,
                    submitted, won, lost, no_bid, expired

  note <notice_id> "text"      Add a note to an opportunity
  tag <notice_id> <cat> <val>  Tag an opportunity
    Categories: capability, technology, industry, strategy, custom

  outcome <notice_id>          Record win/loss outcome
    --result <result>          won, lost, no_bid, withdrawn, cancelled
    --amount <dollars>         Award amount
    --winner <name>            Winner name (if lost)
    --debrief "notes"          Debrief notes

Analytics Commands:
  pipeline                     View pursuit pipeline summary
    --sort <column>            Sort active pursuits (deadline, score)

  stats                        View aggregate statistics
    --group-by <dimension>     pipeline, agency, naics, set-aside, win-loss

Dashboard Commands:
  dashboard-sync <notice_id>   Sync opportunity to deadline dashboard
                               (auto-triggered on status → pursuing)
  sync-top                     Sync top 25 scored opportunities to dashboard widget
    --verbose                  Show detailed output
  alerts                       Send deadline email alerts
    --dry-run                  Preview what would be sent
    --verbose                  Show detailed output
`);
}

async function getDb() {
  const { config } = loadConfig(null);
  return initStorage(config.storage.sqlite_path);
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv);
  const dryRun = Boolean(flags.get("dry-run"));
  const verbose = Boolean(flags.get("verbose"));
  const configPath = flags.get("config") || null;
  const profiles = flags.get("profiles") || "";
  const profileNames = profiles ? profiles.split(",").map(s => s.trim()) : [];

  if (command === "help" || flags.has("help")) {
    printHelp();
    return;
  }

  if (command === "run") {
    await runOpportunityBot({ dryRun, configPath, verbose, profileNames });
    // Auto-sync ALL opportunities to Supabase
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const db = await getDb();
      await syncAllOpportunities(db, { verbose });
    }
    return;
  }

  if (command === "backfill") {
    const days = Number(flags.get("days") ?? 7);
    await runOpportunityBot({ dryRun, configPath, backfillDays: days, verbose, profileNames });
    // Auto-sync top opportunities to Supabase if env vars are set
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const db = await getDb();
      await handleSyncTop(db, { verbose });
    }
    return;
  }

  // --- Intelligence commands (need DB only, not full bot) ---

  if (command === "query") {
    const db = await getDb();
    await handleQuery(db, {
      minScore: flags.get("min-score") ? Number(flags.get("min-score")) : undefined,
      maxScore: flags.get("max-score") ? Number(flags.get("max-score")) : undefined,
      setAside: flags.get("set-aside") || undefined,
      agency: flags.get("agency") || undefined,
      status: flags.get("status") || undefined,
      naics: flags.get("naics") || undefined,
      keyword: flags.get("keyword") || undefined,
      fitLabel: flags.get("label") || undefined,
      limit: flags.get("limit") ? Number(flags.get("limit")) : undefined,
      sortBy: flags.get("sort") || undefined,
    });
    return;
  }

  if (command === "show") {
    const noticeId = positional[0];
    if (!noticeId) {
      console.error("Usage: node bot/cli.js show <notice_id>");
      process.exit(1);
    }
    const db = await getDb();
    await handleShow(db, noticeId);
    return;
  }

  if (command === "compare") {
    if (positional.length < 2) {
      console.error("Usage: node bot/cli.js compare <id1> <id2> [id3 ...]");
      process.exit(1);
    }
    const db = await getDb();
    await handleCompare(db, positional);
    return;
  }

  if (command === "pipeline") {
    const db = await getDb();
    await handlePipeline(db, flags.get("sort") || null);
    return;
  }

  if (command === "status") {
    const noticeId = positional[0];
    const newStatus = positional[1];
    const db = await getDb();
    await handleStatus(db, noticeId, newStatus);
    return;
  }

  if (command === "note") {
    const noticeId = positional[0];
    const noteText = positional.slice(1).join(" ") || flags.get("text");
    const db = await getDb();
    await handleNote(db, noticeId, noteText);
    return;
  }

  if (command === "tag") {
    const noticeId = positional[0];
    const category = positional[1];
    const value = positional[2];
    const db = await getDb();
    await handleTag(db, noticeId, category, value);
    return;
  }

  if (command === "outcome") {
    const noticeId = positional[0];
    if (!noticeId) {
      console.error("Usage: node bot/cli.js outcome <notice_id> --result won|lost|no_bid");
      process.exit(1);
    }
    const db = await getDb();
    await handleOutcome(db, noticeId, flags);
    return;
  }

  if (command === "stats") {
    const db = await getDb();
    await handleStats(db, flags);
    return;
  }

  if (command === "dashboard-sync") {
    const noticeId = positional[0];
    const db = await getDb();
    await handleDashboardSync(db, noticeId);
    return;
  }

  if (command === "sync-top") {
    const db = await getDb();
    await handleSyncTop(db, { verbose });
    return;
  }

  if (command === "alerts") {
    await handleAlerts(flags);
    return;
  }

  console.error(`Unknown command: "${command}". Use "node bot/cli.js help" for usage.`);
  process.exit(1);
}

main().catch((error) => {
  console.error("[opportunity-bot] Fatal error:", error.message);
  process.exit(1);
});
