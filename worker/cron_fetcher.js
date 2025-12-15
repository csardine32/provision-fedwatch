import { fetchSamNotices } from "../api/fetch_sam_notices.js";

export async function handler() {
  await fetchSamNotices();
}

// If invoked directly
if (import.meta.main) {
  handler();
}
