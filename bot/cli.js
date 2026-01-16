#!/usr/bin/env node
import dotenv from "dotenv";
// import { runOpportunityBot } from "./runner.js";

console.log("Attempting to load .env file...");
try {
  dotenv.config();
  console.log(".env file loaded successfully.");
  console.log("MY_TEST_VAR value:", process.env.MY_TEST_VAR);
} catch (error) {
  console.error("Error loading .env file:", error);
}

console.log("Script finished.");
process.exit(0);
