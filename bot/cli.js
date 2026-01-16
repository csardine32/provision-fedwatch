#!/usr/bin/env node
import dotenv from "dotenv";
import { runOpportunityBot } from "./runner.js";

try {
  dotenv.config();
} catch (error) {
  console.error("Error loading .env file:", error);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || "run";
  const flags = new Map();
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "");
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
      flags.set(key, value);
      if (value !== true) i += 1;
    }
  }
  return { command, flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv);
  const dryRun = Boolean(flags.get("dry-run"));
  const verbose = Boolean(flags.get("verbose"));
  const configPath = flags.get("config") || null;

  if (command === "run") {
    await runOpportunityBot({ dryRun, configPath, verbose });
    return;
  }

  if (command === "backfill") {
    const days = Number(flags.get("days") ?? 7);
    await runOpportunityBot({ dryRun, configPath, backfillDays: days, verbose });
    return;
  }

  console.error("Unknown command. Use: run | backfill --days N");
  process.exit(1);
}

main().catch((error) => {
  console.error("[opportunity-bot] Fatal error:", error.message);
  process.exit(1);
});