import { samSearch } from "./utils/sam_client.js";
import { db } from "./utils/db.js";

export async function fetchSamNotices() {
  const query = {
    keywords: ["AI", "automation", "machine learning", "data", "analytics", "ETL", "web portal", "custom software"],
    notice_types: ["r", "p", "o", "k"],
    psc: ["D", "R", "R410"],
    naics: [541511, 541512, 541513, 541519, 541611, 541618, 541690, 518210],
  };

  const results = await samSearch(query);
  await db.saveNotices(results);
}
