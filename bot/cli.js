#!/usr/bin/env node
console.log("Starting cli.js");

import dotenv from "dotenv";
console.log("dotenv imported");

try {
  dotenv.config();
  console.log("Loaded ENV Keys:", Object.keys(process.env));
  console.log("MY_TEST_VAR value:", process.env.MY_TEST_VAR); // New line
} catch (error) {
  console.error("Error loading .env file:", error);
}

process.exit(0);
