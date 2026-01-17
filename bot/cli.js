#!/usr/bin/env node
console.log("[cli] Script started");
import dotenv from "dotenv";
console.log("[cli] dotenv imported");
import { runOpportunityBot } from "./runner.js";
console.log("[cli] runOpportunityBot imported");

console.log("[cli] Calling dotenv.config()...");
try {
  dotenv.config();
  console.log("[cli] dotenv.config() successful.");
} catch (error) {
  console.error("[cli] Error loading .env file:", error);
}

console.log("[cli] After dotenv.config() block.");

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
  console.log("[cli] main() function started.");
  const { command, flags } = parseArgs(process.argv);
  const dryRun = Boolean(flags.get("dry-run"));
  const verbose = Boolean(flags.get("verbose"));
  const configPath = flags.get("config") || null;

  if (command === "run") {
    console.log("[cli] Calling runOpportunityBot for 'run' command...");
    await runOpportunityBot({ dryRun, configPath, verbose });
    console.log("[cli] runOpportunityBot finished for 'run' command.");
    return;
  }

  if (command === "backfill") {
    const days = Number(flags.get("days") ?? 7);
    console.log(`[cli] Calling runOpportunityBot for 'backfill' command (days: ${days})...`);
    await runOpportunityBot({ dryRun, configPath, backfillDays: days, verbose });
    console.log("[cli] runOpportunityBot finished for 'backfill' command.");
    return;
  }

  console.error("Unknown command. Use: run | backfill --days N");
  process.exit(1);
}

console.log("[cli] Calling main().catch()...");
main().catch((error) => {
  console.error("[opportunity-bot] Fatal error:", error.message);
  process.exit(1);
});
console.log("[cli] After main().catch() block.");
