import fetch from "node-fetch";
import { secrets } from "../../config/keys/service.js";

export async function samSearch(query) {
  const url = `https://api.sam.gov/opportunities/v2/search?limit=100&api_key=${secrets.sam_api_key}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });

  return resp.json();
}
