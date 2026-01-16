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
  return db;
}

export async function upsertOpportunity(db, opportunity, descriptionText, attachmentText, hash, nowIso) {
  const existing = await get(db, "SELECT notice_id, hash FROM opportunities WHERE notice_id = ?", [
    opportunity.noticeId,
  ]);
  if (!existing) {
    await run(
      db,
      `INSERT INTO opportunities (
        notice_id, solicitation_number, title, agency, posted_date, response_deadline,
        naics_code, set_aside, classification_code, ui_link, data_json, description_text, attachment_text,
        last_seen_at, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(opportunity),
        descriptionText,
        attachmentText,
        nowIso,
        hash,
      ]
    );
  } else {
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
        hash = ?
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
        JSON.stringify(opportunity),
        descriptionText,
        attachmentText,
        nowIso,
        hash,
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
    `UPDATE opportunities SET last_scored_at = ?, last_fit_label = ?, last_score = ?, last_confidence = ?
     WHERE notice_id = ?`,
    [nowIso, score.fit_label, score.fit_score, score.confidence, noticeId]
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