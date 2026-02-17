// ============================================================
// Sync Opportunities — Push opportunities to Supabase
// Two modes:
//   syncTopOpportunities() — legacy: top 25 scored (used by 'run' command)
//   syncAllOpportunities() — new: ALL active opps (used by 'scan' command)
// ============================================================

import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables. " +
      "Set them in your .env file to enable opportunities sync."
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
        ai_reasons_json, estimated_value,
        ai_risks_json, ai_skillsets_json, ai_key_dates_json,
        ai_must_check_json, ai_attachment_summary, ai_is_relevant,
        data_json, state, city, zip, notice_type,
        SUBSTR(description_text, 1, 2000) as description_excerpt
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
 * Query SQLite for ALL active opportunities (for broad scan sync).
 * No score filter — scoring happens client-side per user.
 */
function queryAllActiveOpportunities(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
        notice_id, title, agency_short, solicitation_number,
        last_score, last_fit_label, response_deadline,
        set_aside, naics_code, ui_link, ai_summary, pursuit_status,
        ai_reasons_json, estimated_value,
        ai_risks_json, ai_skillsets_json, ai_key_dates_json,
        ai_must_check_json, ai_attachment_summary, ai_is_relevant,
        data_json, state, city, zip, notice_type,
        SUBSTR(description_text, 1, 4000) as description_text
      FROM opportunities
      WHERE (response_deadline IS NULL OR response_deadline >= date('now', '-7 days'))
        AND last_seen_at >= date('now', '-30 days')
      ORDER BY last_seen_at DESC`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

/**
 * Build a Supabase record from an SQLite row.
 */
function buildRecord(row, nowIso, { includeDescriptionText = false } = {}) {
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
    ai_risks_json: row.ai_risks_json || null,
    ai_skillsets_json: row.ai_skillsets_json || null,
    ai_key_dates_json: row.ai_key_dates_json || null,
    ai_must_check_json: row.ai_must_check_json || null,
    ai_attachment_summary: row.ai_attachment_summary || null,
    ai_is_relevant: row.ai_is_relevant != null ? Boolean(row.ai_is_relevant) : null,
    state: row.state || null,
    city: row.city || null,
    zip: row.zip || null,
    notice_type: row.notice_type || null,
    resource_links_json: (() => {
      try { return JSON.parse(row.data_json)?.resourceLinks ? JSON.stringify(JSON.parse(row.data_json).resourceLinks) : null; }
      catch { return null; }
    })(),
    synced_at: nowIso,
  };

  if (includeDescriptionText) {
    record.description_text = row.description_text || null;
  }
  // For legacy sync, include description_excerpt
  if (row.description_excerpt !== undefined) {
    record.description_excerpt = row.description_excerpt || null;
  }

  return record;
}

/**
 * Sync top opportunities to Supabase scanner_opportunities table.
 * Upserts current top 25, deletes rows no longer in top 25.
 * (Legacy — used by 'run' command)
 */
export async function syncTopOpportunities(db, { verbose = false, logger = console } = {}) {
  const supabase = getSupabaseClient();
  const rows = await queryTopOpportunities(db);

  if (verbose) logger.log(`[sync-top] Found ${rows.length} opportunities to sync`);

  if (rows.length === 0) {
    logger.log("[sync-top] No opportunities meet threshold (score >= 50, future deadline). Nothing to upsert.");
    return { synced: 0 };
  }

  const nowIso = new Date().toISOString();
  const noticeIds = [];

  for (const row of rows) {
    noticeIds.push(row.notice_id);
    const record = buildRecord(row, nowIso);

    const { error } = await supabase
      .from("scanner_opportunities")
      .upsert(record, { onConflict: "notice_id" });

    if (error) {
      logger.error(`[sync-top] Failed to upsert ${row.notice_id}:`, error.message);
    } else if (verbose) {
      logger.log(`[sync-top] Upserted: ${row.title} (score: ${row.last_score})`);
    }
  }

  // NOTE: No delete step — broad scan (syncAll) owns the full table.
  // sync-top only upserts scored data on top of existing rows.
  logger.log(`[sync-top] Done — ${rows.length} synced`);
  return { synced: rows.length };
}

/**
 * Sync ALL active opportunities to Supabase scanner_opportunities table.
 * No score filter — stores everything for client-side filtering + scoring.
 * Upserts in batches of 50 for efficiency.
 */
export async function syncAllOpportunities(db, { verbose = false, logger = console } = {}) {
  const supabase = getSupabaseClient();
  const rows = await queryAllActiveOpportunities(db);

  logger.log(`[sync-all] Found ${rows.length} active opportunities to sync`);

  if (rows.length === 0) {
    logger.log("[sync-all] No active opportunities found.");
    return { synced: 0, errors: 0 };
  }

  const nowIso = new Date().toISOString();
  const batchSize = 50;
  let synced = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const records = batch.map(row => buildRecord(row, nowIso, { includeDescriptionText: true }));

    const { error } = await supabase
      .from("scanner_opportunities")
      .upsert(records, { onConflict: "notice_id" });

    if (error) {
      logger.error(`[sync-all] Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message);
      errors += batch.length;
    } else {
      synced += batch.length;
      if (verbose) {
        logger.log(`[sync-all] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} upserted`);
      }
    }
  }

  // Clean up stale rows (not seen in last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: stale, error: cleanError } = await supabase
    .from("scanner_opportunities")
    .delete()
    .lt("synced_at", thirtyDaysAgo)
    .select("notice_id");

  if (cleanError) {
    logger.error("[sync-all] Failed to clean stale rows:", cleanError.message);
  }

  const staleCount = stale?.length || 0;
  logger.log(`[sync-all] Done — ${synced} synced, ${errors} errors, ${staleCount} stale removed`);
  return { synced, errors, staleRemoved: staleCount };
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
