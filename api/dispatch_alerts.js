import fetch from "node-fetch";
import { db } from "./utils/db.js";
import { secrets } from "../config/keys/service.js";

export async function dispatchAlerts() {
  const alerts = await db.getAlerts();

  for (const alert of alerts) {
    await fetch(secrets.notifications.slack_webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 New Opportunity: ${alert.title}\nScore: ${alert.score}\n${alert.url}`,
      }),
    });
  }
}
