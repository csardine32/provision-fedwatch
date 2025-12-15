import { scoreNotices } from "../api/score_notice.js";

export async function handler() {
  await scoreNotices();
}

if (import.meta.main) {
  handler();
}
