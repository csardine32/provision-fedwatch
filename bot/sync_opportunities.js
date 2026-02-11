// ============================================================
// Sync Top Opportunities — Push top-scored opps to Supabase
// Called after bot runs to keep dashboard widget current
// ============================================================

import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables. " +
      "Set them in your .env file to enable top-opportunities sync."
    );
  }

  return createClient(url, key);
}

/**
 * Query SQLite for top 25 scored opportunities (score >= 50, future or no deadline).
 */
function queryTopOpportunities(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
        notice_id, title, agency_short, solicitation_number,
        last_score, last_fit_label, response_deadline,
        set_aside, naics_code, ui_link, ai_summary, pursuit_status,
        ai_reasons_json, estimated_value
      FROM opportunities
      WHERE last_score >= 50
        AND last_scored_at IS NOT NULL
        AND (response_deadline IS NULL OR response_deadline >= date('now'))
      ORDER BY last_score DESC
      LIMIT 25`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

/**
 * Sync top opportunities to Supabase scanner_opportunities table.
 * Upserts current top 25, deletes rows no longer in top 25.
 */
export async function syncTopOpportunities(db, { verbose = false, logger = console } = {}) {
  const supabase = getSupabaseClient();
  const rows = await queryTopOpportunities(db);

  if (verbose) logger.log(`[sync-top] Found ${rows.length} opportunities to sync`);

  if (rows.length === 0) {
    logger.log("[sync-top] No opportunities meet threshold (score >= 50, future deadline). Clearing table.");
    await supabase.from("scanner_opportunities").delete().neq("notice_id", "");
    return { synced: 0, deleted: 0 };
  }

  const nowIso = new Date().toISOString();
  const noticeIds = [];

  for (const row of rows) {
    noticeIds.push(row.notice_id);

    const record = {
      notice_id: row.notice_id,
      title: row.title,
      agency: row.agency_short || null,
      solicitation_number: row.solicitation_number || null,
      last_score: row.last_score,
      last_fit_label: row.last_fit_label || null,
      response_deadline: row.response_deadline || null,
      set_aside: row.set_aside || null,
      naics_code: row.naics_code || null,
      ui_link: row.ui_link || null,
      ai_summary: row.ai_summary || null,
      pursuit_status: row.pursuit_status || "discovered",
      ai_reasons_json: row.ai_reasons_json || null,
      estimated_value: row.estimated_value || null,
      synced_at: nowIso,
    };

    const { error } = await supabase
      .from("scanner_opportunities")
      .upsert(record, { onConflict: "notice_id" });

    if (error) {
      logger.error(`[sync-top] Failed to upsert ${row.notice_id}:`, error.message);
    } else if (verbose) {
      logger.log(`[sync-top] Upserted: ${row.title} (score: ${row.last_score})`);
    }
  }

  // Delete rows no longer in top 25
  const { data: deleted, error: deleteError } = await supabase
    .from("scanner_opportunities")
    .delete()
    .not("notice_id", "in", `(${noticeIds.map(id => `"${id}"`).join(",")})`)
    .select("notice_id");

  if (deleteError) {
    logger.error("[sync-top] Failed to clean stale rows:", deleteError.message);
  }

  const deletedCount = deleted?.length || 0;
  logger.log(`[sync-top] Done — ${rows.length} synced, ${deletedCount} stale removed`);
  return { synced: rows.length, deleted: deletedCount };
}

/**
 * CLI handler for sync-top command.
 */
export async function handleSyncTop(db, { verbose = false, logger = console } = {}) {
  try {
    await syncTopOpportunities(db, { verbose, logger });
  } catch (err) {
    if (err.message.includes("SUPABASE_URL")) {
      logger.error(err.message);
    } else {
      logger.error("[sync-top] Error:", err.message);
    }
  }
}
