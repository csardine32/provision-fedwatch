import { createClient } from "@supabase/supabase-js";
import { secrets } from "../../config/keys/service.js";

const supabase = createClient(secrets.database.url, secrets.database.anon_key);

export const db = {
  async saveNotices(results) {
    const opportunities = results?.opportunitiesData ?? [];
    if (!opportunities.length) return;
    const rows = opportunities.map((item) => ({
      id: item.noticeId,
      data: item,
    }));
    await supabase.from("notices_raw").upsert(rows);
  },

  async getUnscored() {
    const { data, error } = await supabase.from("notices_raw").select("*");
    if (error) throw error;
    return data ?? [];
  },

  async saveScore(id, score) {
    await supabase.from("notices_processed").upsert({
      id,
      score,
    });
  },

  async getAlerts() {
    const { data, error } = await supabase.from("alerts").select("*");
    if (error) throw error;
    return data ?? [];
  },
};
