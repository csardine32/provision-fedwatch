import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function openDb(dbPath) {
  ensureDir(dbPath);
  return new sqlite3.Database(dbPath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function safeAddColumn(db, table, column, type) {
  try {
    await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (_) {
    // Column already exists — safe to ignore
  }
}

function parseAgencyShort(agencyPath) {
  if (!agencyPath) return null;
  const parts = agencyPath.split(".");
  const top = (parts[0] || "").trim();
  const second = (parts[1] || "").trim();

  const abbreviations = {
    "DEPT OF DEFENSE": "DOD",
    "DEPT OF VETERANS AFFAIRS": "VA",
    "DEPT OF HOMELAND SECURITY": "DHS",
    "DEPT OF HEALTH AND HUMAN SERVICES": "HHS",
    "GENERAL SERVICES ADMINISTRATION": "GSA",
    "DEPT OF AGRICULTURE": "USDA",
    "DEPT OF THE INTERIOR": "DOI",
    "DEPT OF ENERGY": "DOE",
    "DEPT OF TRANSPORTATION": "DOT",
    "DEPT OF JUSTICE": "DOJ",
    "DEPT OF COMMERCE": "DOC",
    "DEPT OF LABOR": "DOL",
    "DEPT OF STATE": "DOS",
    "DEPT OF THE TREASURY": "Treasury",
    "DEPT OF EDUCATION": "ED",
    "DEPT OF HOUSING AND URBAN DEVELOPMENT": "HUD",
    "ENVIRONMENTAL PROTECTION AGENCY": "EPA",
    "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION": "NASA",
    "SMALL BUSINESS ADMINISTRATION": "SBA",
    "SOCIAL SECURITY ADMINISTRATION": "SSA",
  };

  const abbr = abbreviations[top] || top;
  if (second && second !== top) {
    const secondClean = second
      .replace(/^DEPT OF THE /, "")
      .replace(/^DEPT OF /, "");
    return `${abbr} / ${secondClean}`;
  }
  return abbr;
}

export { parseAgencyShort };

export async function initStorage(dbPath) {
  const db = openDb(dbPath);
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS opportunities (
      notice_id TEXT PRIMARY KEY,
      solicitation_number TEXT,
      title TEXT,
      agency TEXT,
      posted_date TEXT,
      response_deadline TEXT,
      naics_code TEXT,
      set_aside TEXT,
      classification_code TEXT,
      ui_link TEXT,
      data_json TEXT,
      description_text TEXT,
      attachment_text TEXT,
      last_seen_at TEXT,
      last_scored_at TEXT,
      last_alerted_at TEXT,
      last_fit_label TEXT,
      last_score REAL,
      last_confidence REAL,
      hash TEXT,
      last_alerted_hash TEXT
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id TEXT,
      fit_label TEXT,
      score REAL,
      payload_json TEXT,
      created_at TEXT
    )`
  );

  // --- Intelligence database migration ---
  // Structured AI analysis columns
  await safeAddColumn(db, "opportunities", "ai_summary", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_reasons_json", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_risks_json", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_skillsets_json", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_key_dates_json", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_attachment_summary", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_must_check_json", "TEXT");
  await safeAddColumn(db, "opportunities", "ai_is_relevant", "INTEGER");

  // Lifecycle tracking
  await safeAddColumn(db, "opportunities", "pursuit_status", "TEXT DEFAULT 'discovered'");
  await safeAddColumn(db, "opportunities", "pursuit_status_changed_at", "TEXT");

  // Derived fields
  await safeAddColumn(db, "opportunities", "agency_short", "TEXT");

  // User annotations
  await safeAddColumn(db, "opportunities", "priority", "INTEGER DEFAULT 0");
  await safeAddColumn(db, "opportunities", "notes", "TEXT");
  await safeAddColumn(db, "opportunities", "folder_path", "TEXT");
  await safeAddColumn(db, "opportunities", "estimated_value", "TEXT");

  // Pursuit events — append-only event log
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS pursuit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      new_status TEXT,
      description TEXT,
      effort_hours REAL,
      cost_dollars REAL,
      event_data_json TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT DEFAULT 'user',
      FOREIGN KEY (notice_id) REFERENCES opportunities(notice_id)
    )`
  );

  // Outcomes — win/loss records
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id TEXT NOT NULL UNIQUE,
      result TEXT NOT NULL,
      award_amount REAL,
      award_date TEXT,
      contract_number TEXT,
      performance_start TEXT,
      performance_end TEXT,
      winner_name TEXT,
      winner_amount REAL,
      debrief_notes TEXT,
      lessons_json TEXT,
      what_worked TEXT,
      what_didnt_work TEXT,
      would_bid_again INTEGER,
      total_effort_hours REAL,
      total_cost_dollars REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (notice_id) REFERENCES opportunities(notice_id)
    )`
  );

  // Tags — flexible categorization
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id TEXT NOT NULL,
      tag_category TEXT NOT NULL,
      tag_value TEXT NOT NULL,
      source TEXT DEFAULT 'user',
      created_at TEXT NOT NULL,
      FOREIGN KEY (notice_id) REFERENCES opportunities(notice_id),
      UNIQUE(notice_id, tag_category, tag_value)
    )`
  );

  // Indexes for new tables
  try { await run(db, `CREATE INDEX IF NOT EXISTS idx_pursuit_events_notice ON pursuit_events(notice_id)`); } catch (_) {}
  try { await run(db, `CREATE INDEX IF NOT EXISTS idx_pursuit_events_type ON pursuit_events(event_type)`); } catch (_) {}
  try { await run(db, `CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(tag_category, tag_value)`); } catch (_) {}
  try { await run(db, `CREATE INDEX IF NOT EXISTS idx_tags_notice ON tags(notice_id)`); } catch (_) {}
  try { await run(db, `CREATE INDEX IF NOT EXISTS idx_outcomes_result ON outcomes(result)`); } catch (_) {}

  return db;
}

function formatEstimatedValue(amount) {
  if (!amount || isNaN(amount)) return null;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function parseValueFromDescription(text) {
  if (!text) return null;
  // Look for dollar amounts like $1,500,000 or $500K or $2.5M or $2.5 million
  const patterns = [
    /\$\s*([\d,]+(?:\.\d+)?)\s*(?:million|mil)\b/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*M\b/,
    /\$\s*([\d,]+(?:\.\d+)?)\s*K\b/,
    /\$\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bil)\b/i,
    /\$\s*([\d,]+(?:\.\d+)?)\b/,
    /([\d,]+(?:\.\d+)?)\s*(?:million|mil)\s*(?:dollars?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const numStr = m[1].replace(/,/g, '');
    let val = parseFloat(numStr);
    if (isNaN(val) || val <= 0) continue;
    const ctx = m[0].toLowerCase();
    if (ctx.includes('million') || ctx.includes('mil') || m[0].includes('M')) val *= 1_000_000;
    else if (ctx.includes('billion') || ctx.includes('bil')) val *= 1_000_000_000;
    else if (m[0].includes('K')) val *= 1_000;
    // Filter implausible values (< $1K or > $10B)
    if (val >= 1_000 && val <= 10_000_000_000) return val;
  }
  return null;
}

export async function upsertOpportunity(db, opportunity, descriptionText, attachmentText, hash, nowIso, { logger }) {
  const existing = await get(db, "SELECT notice_id, hash FROM opportunities WHERE notice_id = ?", [
    opportunity.noticeId,
  ]);
  const agencyShort = parseAgencyShort(opportunity.agencyPath);

  // Derive estimated value: award amount (Award Notices) → description parse → null
  const rawValue = opportunity.awardAmount || parseValueFromDescription(descriptionText);
  const estimatedValue = formatEstimatedValue(rawValue);

  if (!existing) {
            const dataJson = JSON.stringify({
              pointOfContact: opportunity.pointOfContact,
              resourceLinks: opportunity.resourceLinks,
            });
            logger.debug(`[storage] Storing opportunity. Attachment text length: ${attachmentText?.length || 0}, JSON data length: ${dataJson.length}`);
            await run(
              db,
              `INSERT INTO opportunities (
                notice_id, solicitation_number, title, agency, posted_date, response_deadline,
                naics_code, set_aside, classification_code, ui_link, data_json, description_text, attachment_text,
                last_seen_at, hash, agency_short, estimated_value
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                opportunity.noticeId,
                opportunity.solicitationNumber,
                opportunity.title,
                opportunity.agencyPath,
                opportunity.postedDate,
                opportunity.responseDeadline,
                opportunity.naicsCode,
                opportunity.setAside || opportunity.setAsideCode,
                opportunity.classificationCode,
                opportunity.uiLink,
                dataJson,
                descriptionText,
                attachmentText,
                nowIso,
                hash,
                agencyShort,
                estimatedValue,
              ]
            );
          } else {
            const dataJson = JSON.stringify({
              pointOfContact: opportunity.pointOfContact,
              resourceLinks: opportunity.resourceLinks,
            });
        await run(
          db,
          `UPDATE opportunities SET
            solicitation_number = ?,
            title = ?,
            agency = ?,
            posted_date = ?,
            response_deadline = ?,
            naics_code = ?,
            set_aside = ?,
            classification_code = ?,
            ui_link = ?,
            data_json = ?,
            description_text = ?,
            attachment_text = ?,
            last_seen_at = ?,
            hash = ?,
            agency_short = ?,
            estimated_value = COALESCE(?, estimated_value)
          WHERE notice_id = ?`,
          [
            opportunity.solicitationNumber,
            opportunity.title,
            opportunity.agencyPath,
            opportunity.postedDate,
            opportunity.responseDeadline,
            opportunity.naicsCode,
            opportunity.setAside || opportunity.setAsideCode,
            opportunity.classificationCode,
            opportunity.uiLink,
            dataJson,
            descriptionText,
            attachmentText,
            nowIso,
            hash,
            agencyShort,
            estimatedValue,
            opportunity.noticeId,
          ]
        );
      }
}

export async function getOpportunityState(db, noticeId) {
  return get(db, "SELECT * FROM opportunities WHERE notice_id = ?", [noticeId]);
}

export async function saveScore(db, noticeId, score, nowIso) {
  await run(
    db,
    `UPDATE opportunities SET
       last_scored_at = ?,
       last_fit_label = ?,
       last_score = ?,
       last_confidence = ?,
       ai_summary = ?,
       ai_reasons_json = ?,
       ai_risks_json = ?,
       ai_skillsets_json = ?,
       ai_key_dates_json = ?,
       ai_attachment_summary = ?,
       ai_must_check_json = ?,
       ai_is_relevant = ?
     WHERE notice_id = ?`,
    [
      nowIso,
      score.fit_label,
      score.fit_score,
      score.confidence,
      score.plain_english_summary || null,
      score.reasons ? JSON.stringify(score.reasons) : null,
      score.risks ? JSON.stringify(score.risks) : null,
      score.required_skillsets ? JSON.stringify(score.required_skillsets) : null,
      score.key_dates ? JSON.stringify(score.key_dates) : null,
      score.attachment_summary || null,
      score.must_check_items ? JSON.stringify(score.must_check_items) : null,
      score.is_relevant != null ? (score.is_relevant ? 1 : 0) : null,
      noticeId,
    ]
  );
}

export async function saveAlert(db, noticeId, score, payload, nowIso, hash) {
  await run(
    db,
    `UPDATE opportunities SET last_alerted_at = ?, last_alerted_hash = ? WHERE notice_id = ?`,
    [nowIso, hash, noticeId]
  );
  await run(
    db,
    `INSERT INTO alerts (notice_id, fit_label, score, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [noticeId, score.fit_label, score.fit_score, JSON.stringify(payload), nowIso]
  );
}

export async function listOpportunities(db, { naicsCodes = [], keywords = [] } = {}) {
  let query = "SELECT * FROM opportunities";
  const params = [];
  const whereClauses = [];

  if (naicsCodes.length > 0) {
    const placeholders = naicsCodes.map(() => "?").join(",");
    whereClauses.push(`naics_code IN (${placeholders})`);
    params.push(...naicsCodes);
  }

  if (keywords.length > 0) {
    const keywordClauses = keywords.map(() => `(title LIKE ? OR description_text LIKE ?)`).join(" OR ");
    whereClauses.push(`(${keywordClauses})`);
    for (const keyword of keywords) {
      const searchTerm = `%${keyword}%`;
      params.push(searchTerm, searchTerm);
    }
  }

  if (whereClauses.length > 0) {
    query += " WHERE " + whereClauses.join(" OR ");
  }

  return all(db, query, params);
}

// --- Intelligence database functions ---

const VALID_STATUSES = ["discovered", "reviewing", "interested", "pursuing", "submitted", "won", "lost", "no_bid", "expired"];

export async function updatePursuitStatus(db, noticeId, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status "${newStatus}". Valid: ${VALID_STATUSES.join(", ")}`);
  }
  const nowIso = new Date().toISOString();
  await run(
    db,
    `UPDATE opportunities SET pursuit_status = ?, pursuit_status_changed_at = ? WHERE notice_id = ?`,
    [newStatus, nowIso, noticeId]
  );
  await addPursuitEvent(db, noticeId, {
    eventType: "status_change",
    newStatus,
    description: `Status changed to ${newStatus}`,
    createdBy: "user",
  });
}

export async function addPursuitEvent(db, noticeId, { eventType, newStatus = null, description = "", effortHours = null, costDollars = null, eventData = null, createdBy = "user" }) {
  const nowIso = new Date().toISOString();
  await run(
    db,
    `INSERT INTO pursuit_events (notice_id, event_type, new_status, description, effort_hours, cost_dollars, event_data_json, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [noticeId, eventType, newStatus, description, effortHours, costDollars, eventData ? JSON.stringify(eventData) : null, nowIso, createdBy]
  );
}

export async function addTag(db, noticeId, category, value, source = "user") {
  const nowIso = new Date().toISOString();
  await run(
    db,
    `INSERT OR IGNORE INTO tags (notice_id, tag_category, tag_value, source, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [noticeId, category, value, source, nowIso]
  );
}

export async function removeTag(db, noticeId, category, value) {
  await run(
    db,
    `DELETE FROM tags WHERE notice_id = ? AND tag_category = ? AND tag_value = ?`,
    [noticeId, category, value]
  );
}

export async function getTagsForOpportunity(db, noticeId) {
  return all(db, `SELECT tag_category, tag_value, source, created_at FROM tags WHERE notice_id = ? ORDER BY tag_category, tag_value`, [noticeId]);
}

export async function recordOutcome(db, noticeId, { result, awardAmount = null, awardDate = null, contractNumber = null, winnerName = null, winnerAmount = null, debriefNotes = null, lessons = null, whatWorked = null, whatDidntWork = null, wouldBidAgain = null }) {
  const nowIso = new Date().toISOString();

  // Sum effort/cost from pursuit events
  const totals = await get(
    db,
    `SELECT COALESCE(SUM(effort_hours), 0) as total_hours, COALESCE(SUM(cost_dollars), 0) as total_cost
     FROM pursuit_events WHERE notice_id = ?`,
    [noticeId]
  );

  await run(
    db,
    `INSERT INTO outcomes (notice_id, result, award_amount, award_date, contract_number, winner_name, winner_amount, debrief_notes, lessons_json, what_worked, what_didnt_work, would_bid_again, total_effort_hours, total_cost_dollars, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(notice_id) DO UPDATE SET
       result = excluded.result,
       award_amount = excluded.award_amount,
       award_date = excluded.award_date,
       contract_number = excluded.contract_number,
       winner_name = excluded.winner_name,
       winner_amount = excluded.winner_amount,
       debrief_notes = excluded.debrief_notes,
       lessons_json = excluded.lessons_json,
       what_worked = excluded.what_worked,
       what_didnt_work = excluded.what_didnt_work,
       would_bid_again = excluded.would_bid_again,
       total_effort_hours = excluded.total_effort_hours,
       total_cost_dollars = excluded.total_cost_dollars,
       updated_at = excluded.created_at`,
    [
      noticeId, result, awardAmount, awardDate, contractNumber, winnerName, winnerAmount,
      debriefNotes, lessons ? JSON.stringify(lessons) : null, whatWorked, whatDidntWork,
      wouldBidAgain != null ? (wouldBidAgain ? 1 : 0) : null,
      totals.total_hours, totals.total_cost, nowIso,
    ]
  );

  // Also update pursuit_status on the opportunity
  const statusMap = { won: "won", lost: "lost", no_bid: "no_bid", withdrawn: "expired", cancelled: "expired" };
  const newStatus = statusMap[result] || result;
  if (VALID_STATUSES.includes(newStatus)) {
    await run(db, `UPDATE opportunities SET pursuit_status = ?, pursuit_status_changed_at = ? WHERE notice_id = ?`, [newStatus, nowIso, noticeId]);
  }
}

export async function queryOpportunities(db, filters = {}) {
  const whereClauses = [];
  const params = [];

  if (filters.minScore != null) {
    whereClauses.push("last_score >= ?");
    params.push(filters.minScore);
  }
  if (filters.maxScore != null) {
    whereClauses.push("last_score <= ?");
    params.push(filters.maxScore);
  }
  if (filters.fitLabel) {
    whereClauses.push("last_fit_label = ?");
    params.push(filters.fitLabel);
  }
  if (filters.setAside) {
    whereClauses.push("set_aside LIKE ?");
    params.push(`%${filters.setAside}%`);
  }
  if (filters.agency) {
    whereClauses.push("(agency_short LIKE ? OR agency LIKE ?)");
    params.push(`%${filters.agency}%`, `%${filters.agency}%`);
  }
  if (filters.status) {
    whereClauses.push("pursuit_status = ?");
    params.push(filters.status);
  }
  if (filters.naics) {
    whereClauses.push("naics_code = ?");
    params.push(filters.naics);
  }
  if (filters.keyword) {
    whereClauses.push("(title LIKE ? OR description_text LIKE ? OR ai_summary LIKE ?)");
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  if (filters.priority != null) {
    whereClauses.push("priority >= ?");
    params.push(filters.priority);
  }
  if (filters.deadlineAfter) {
    whereClauses.push("response_deadline >= ?");
    params.push(filters.deadlineAfter);
  }
  if (filters.scored !== undefined) {
    if (filters.scored) {
      whereClauses.push("last_scored_at IS NOT NULL");
    } else {
      whereClauses.push("last_scored_at IS NULL");
    }
  }

  let sql = `SELECT notice_id, solicitation_number, title, agency_short, naics_code, set_aside,
    last_fit_label, last_score, response_deadline, pursuit_status, priority, ai_summary, ui_link
    FROM opportunities`;

  if (whereClauses.length > 0) {
    sql += " WHERE " + whereClauses.join(" AND ");
  }

  const orderBy = filters.sortBy || "last_score";
  const orderDir = filters.sortDir || "DESC";
  sql += ` ORDER BY ${orderBy} ${orderDir}`;

  if (filters.limit) {
    sql += ` LIMIT ?`;
    params.push(filters.limit);
  }

  return all(db, sql, params);
}

export async function getFullOpportunity(db, noticeId) {
  const opp = await get(db, "SELECT * FROM opportunities WHERE notice_id = ? OR solicitation_number = ?", [noticeId, noticeId]);
  if (!opp) return null;

  const tags = await getTagsForOpportunity(db, opp.notice_id);
  const events = await all(db, "SELECT * FROM pursuit_events WHERE notice_id = ? ORDER BY created_at DESC", [opp.notice_id]);
  const outcome = await get(db, "SELECT * FROM outcomes WHERE notice_id = ?", [opp.notice_id]);

  return { ...opp, tags, events, outcome };
}

export async function getPipelineStats(db) {
  return all(
    db,
    `SELECT
       pursuit_status,
       COUNT(*) as count,
       ROUND(AVG(last_score), 1) as avg_score,
       SUM(CASE WHEN response_deadline >= date('now') THEN 1 ELSE 0 END) as still_open
     FROM opportunities
     WHERE last_scored_at IS NOT NULL
     GROUP BY pursuit_status
     ORDER BY
       CASE pursuit_status
         WHEN 'submitted' THEN 1 WHEN 'pursuing' THEN 2
         WHEN 'interested' THEN 3 WHEN 'reviewing' THEN 4
         WHEN 'discovered' THEN 5 WHEN 'won' THEN 6
         WHEN 'lost' THEN 7 WHEN 'no_bid' THEN 8 WHEN 'expired' THEN 9
       END`
  );
}

export async function getAgencyStats(db) {
  return all(
    db,
    `SELECT agency_short, COUNT(*) as total,
       SUM(CASE WHEN last_fit_label = 'GOOD_FIT' THEN 1 ELSE 0 END) as good_fit,
       ROUND(AVG(last_score), 1) as avg_score
     FROM opportunities
     WHERE last_scored_at IS NOT NULL AND agency_short IS NOT NULL
     GROUP BY agency_short
     ORDER BY good_fit DESC, total DESC`
  );
}

export async function getNaicsStats(db) {
  return all(
    db,
    `SELECT naics_code, COUNT(*) as total,
       SUM(CASE WHEN last_fit_label = 'GOOD_FIT' THEN 1 ELSE 0 END) as good_fit,
       ROUND(AVG(last_score), 1) as avg_score
     FROM opportunities
     WHERE last_scored_at IS NOT NULL AND naics_code IS NOT NULL
     GROUP BY naics_code
     ORDER BY good_fit DESC, total DESC`
  );
}

export async function getSetAsideStats(db) {
  return all(
    db,
    `SELECT set_aside, COUNT(*) as total,
       SUM(CASE WHEN last_fit_label = 'GOOD_FIT' THEN 1 ELSE 0 END) as good_fit,
       ROUND(AVG(last_score), 1) as avg_score
     FROM opportunities
     WHERE last_scored_at IS NOT NULL AND set_aside IS NOT NULL
     GROUP BY set_aside
     ORDER BY good_fit DESC, total DESC`
  );
}

export async function getWinLossStats(db) {
  const results = await all(
    db,
    `SELECT o.result, COUNT(*) as count,
       ROUND(AVG(opp.last_score), 1) as avg_score
     FROM outcomes o
     JOIN opportunities opp ON o.notice_id = opp.notice_id
     GROUP BY o.result`
  );
  const total = results.reduce((sum, r) => sum + r.count, 0);
  return { results, total };
}

export async function getPursuitEvents(db, noticeId) {
  return all(db, "SELECT * FROM pursuit_events WHERE notice_id = ? ORDER BY created_at DESC", [noticeId]);
}

export { VALID_STATUSES };