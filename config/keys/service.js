import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "config", "keys", "service.json");
const raw = fs.readFileSync(filePath, "utf8");
export const secrets = JSON.parse(raw);
