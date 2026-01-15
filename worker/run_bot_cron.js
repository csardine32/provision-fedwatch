import { runOpportunityBot } from "../bot/runner.js";

async function main() {
  try {
    await runOpportunityBot();
  } catch (error) {
    console.error("Error running the opportunity bot:", error);
    process.exit(1);
  }
}

main();
