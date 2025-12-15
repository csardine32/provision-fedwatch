import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readVersion() {
  const candidatePaths = [
    path.join(process.cwd(), "package.json"),
    path.join(__dirname, "..", "..", "package.json"),
  ];

  for (const pkgPath of candidatePaths) {
    try {
      const raw = fs.readFileSync(pkgPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.version) return parsed.version;
    } catch (_err) {
      // Ignore and try the next candidate path.
    }
  }

  return "dev";
}

export function systemMeta() {
  return {
    appName: "ProVision Systems – Fed Watch",
    environment: process.env.NODE_ENV || "unknown",
    version: readVersion(),
    timestamp: new Date().toISOString(),
  };
}
