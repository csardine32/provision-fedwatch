import { systemMeta } from "./utils/system_meta.js";

export default function handler(req, res) {
  if (req?.method && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader?.("Allow", "GET");
    res.end?.("Method Not Allowed");
    return;
  }

  const payload = systemMeta();

  res.statusCode = 200;
  res.setHeader?.("Content-Type", "application/json");
  res.end?.(JSON.stringify(payload));
}
