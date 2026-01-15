import fs from "fs";
import path from "path";

export function loadConfig(configPath) {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), "config", "opportunity-bot.json");
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config not found at ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  const config = JSON.parse(raw);
  return { config, configPath: resolved };
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set.`);
  }
  return value;
}
