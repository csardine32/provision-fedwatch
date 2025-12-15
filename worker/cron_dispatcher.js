import { dispatchAlerts } from "../api/dispatch_alerts.js";

export async function handler() {
  await dispatchAlerts();
}

if (import.meta.main) {
  handler();
}
