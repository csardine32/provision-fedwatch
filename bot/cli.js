#!/usr/bin/env node
console.log("Starting cli.js");

import dotenv from "dotenv";
console.log("dotenv imported");

try {
  dotenv.config();
  console.log("Loaded ENV Keys:", Object.keys(process.env));
} catch (error) {
  console.error("Error loading .env file:", error);
}

process.exit(0);