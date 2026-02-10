import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initStorage,
  saveScore,
  upsertOpportunity,
  updatePursuitStatus,
  addPursuitEvent,
  addTag,
  removeTag,
  getTagsForOpportunity,
  recordOutcome,
  queryOpportunities,
  getFullOpportunity,
  getPipelineStats,
  getAgencyStats,
  getNaicsStats,
  getSetAsideStats,
  parseAgencyShort,
  VALID_STATUSES,
} from "../bot/storage.js";

const TEST_DB = ".data/test-intelligence.sqlite";

function cleanup() {
  try { fs.unlinkSync(TEST_DB); } catch (_) {}
}

function makeOpp(overrides = {}) {
  return {
    noticeId: overrides.noticeId || "test-" + Math.random().toString(36).slice(2, 8),
    solicitationNumber: overrides.solicitationNumber || "SOL-001",
    title: overrides.title || "Test Opportunity",
    agencyPath: overrides.agencyPath || "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AIR FORCE DISTRICT",
    postedDate: "2026-01-15",
    responseDeadline: "2026-02-15",
    naicsCode: overrides.naicsCode || "541519",
    setAside: overrides.setAside || "SDVOSB",
    setAsideCode: overrides.setAsideCode || "SDVOSBC",
    classificationCode: "D301",
    uiLink: "https://sam.gov/test",
    pointOfContact: [],
    resourceLinks: [],
    ...overrides,
  };
}

const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

test("parseAgencyShort abbreviates known agencies", () => {
  assert.equal(parseAgencyShort("DEPT OF DEFENSE.DEPT OF THE AIR FORCE.SOME WING"), "DOD / AIR FORCE");
  assert.equal(parseAgencyShort("DEPT OF VETERANS AFFAIRS"), "VA");
  assert.equal(parseAgencyShort("GENERAL SERVICES ADMINISTRATION"), "GSA");
  assert.equal(parseAgencyShort("DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSEA"), "DOD / NAVY");
  assert.equal(parseAgencyShort("NATIONAL AERONAUTICS AND SPACE ADMINISTRATION"), "NASA");
  assert.equal(parseAgencyShort(null), null);
  assert.equal(parseAgencyShort(""), null);
});

test("Schema migration creates all tables and columns", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  // Check opportunities columns
  const cols = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(opportunities)", (err, rows) => err ? reject(err) : resolve(rows));
  });
  const colNames = cols.map(c => c.name);
  assert.ok(colNames.includes("ai_summary"), "Missing ai_summary column");
  assert.ok(colNames.includes("ai_reasons_json"), "Missing ai_reasons_json column");
  assert.ok(colNames.includes("pursuit_status"), "Missing pursuit_status column");
  assert.ok(colNames.includes("agency_short"), "Missing agency_short column");
  assert.ok(colNames.includes("priority"), "Missing priority column");
  assert.ok(colNames.includes("folder_path"), "Missing folder_path column");

  // Check new tables exist
  const tables = await new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => err ? reject(err) : resolve(rows));
  });
  const tableNames = tables.map(t => t.name);
  assert.ok(tableNames.includes("pursuit_events"), "Missing pursuit_events table");
  assert.ok(tableNames.includes("outcomes"), "Missing outcomes table");
  assert.ok(tableNames.includes("tags"), "Missing tags table");

  db.close();
  cleanup();
});

test("saveScore persists full AI analysis", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  const opp = makeOpp({ noticeId: "score-test-1" });
  await upsertOpportunity(db, opp, "desc", "attach", "hash1", new Date().toISOString(), { logger: mockLogger });

  const score = {
    is_relevant: true,
    plain_english_summary: "This is a test summary",
    required_skillsets: ["Node.js", "SQLite"],
    fit_label: "GOOD_FIT",
    fit_score: 85,
    confidence: 0.9,
    reasons: ["Good automation potential", "Small business friendly"],
    risks: ["Short deadline"],
    key_dates: { due_date: "2026-02-15", other_dates: ["2026-02-01 Q&A"] },
    attachment_summary: "PWS and pricing docs",
    must_check_items: ["Insurance requirements", "Past performance"],
  };

  await saveScore(db, "score-test-1", score, new Date().toISOString());

  const row = await new Promise((resolve, reject) => {
    db.get("SELECT * FROM opportunities WHERE notice_id = ?", ["score-test-1"], (err, row) => err ? reject(err) : resolve(row));
  });

  assert.equal(row.ai_summary, "This is a test summary");
  assert.equal(row.ai_is_relevant, 1);
  assert.equal(row.last_fit_label, "GOOD_FIT");
  assert.equal(row.last_score, 85);

  const reasons = JSON.parse(row.ai_reasons_json);
  assert.equal(reasons.length, 2);
  assert.equal(reasons[0], "Good automation potential");

  const skills = JSON.parse(row.ai_skillsets_json);
  assert.ok(skills.includes("SQLite"));

  const dates = JSON.parse(row.ai_key_dates_json);
  assert.equal(dates.due_date, "2026-02-15");

  db.close();
  cleanup();
});

test("upsertOpportunity sets agency_short", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  const opp = makeOpp({ noticeId: "agency-test-1", agencyPath: "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSEA" });
  await upsertOpportunity(db, opp, "", "", "h1", new Date().toISOString(), { logger: mockLogger });

  const row = await new Promise((resolve, reject) => {
    db.get("SELECT agency_short FROM opportunities WHERE notice_id = ?", ["agency-test-1"], (err, row) => err ? reject(err) : resolve(row));
  });

  assert.equal(row.agency_short, "DOD / NAVY");

  db.close();
  cleanup();
});

test("updatePursuitStatus validates and logs events", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  const opp = makeOpp({ noticeId: "status-test-1" });
  await upsertOpportunity(db, opp, "", "", "h1", new Date().toISOString(), { logger: mockLogger });

  await updatePursuitStatus(db, "status-test-1", "reviewing");

  const row = await new Promise((resolve, reject) => {
    db.get("SELECT pursuit_status FROM opportunities WHERE notice_id = ?", ["status-test-1"], (err, row) => err ? reject(err) : resolve(row));
  });
  assert.equal(row.pursuit_status, "reviewing");

  // Check event was logged
  const events = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM pursuit_events WHERE notice_id = ?", ["status-test-1"], (err, rows) => err ? reject(err) : resolve(rows));
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "status_change");
  assert.equal(events[0].new_status, "reviewing");

  // Invalid status should throw
  await assert.rejects(
    () => updatePursuitStatus(db, "status-test-1", "invalid_status"),
    /Invalid status/
  );

  db.close();
  cleanup();
});

test("Tags can be added, retrieved, and removed", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  const opp = makeOpp({ noticeId: "tag-test-1" });
  await upsertOpportunity(db, opp, "", "", "h1", new Date().toISOString(), { logger: mockLogger });

  await addTag(db, "tag-test-1", "capability", "iot");
  await addTag(db, "tag-test-1", "technology", "node.js");
  await addTag(db, "tag-test-1", "capability", "iot"); // duplicate — should be ignored

  const tags = await getTagsForOpportunity(db, "tag-test-1");
  assert.equal(tags.length, 2);

  await removeTag(db, "tag-test-1", "capability", "iot");
  const tagsAfter = await getTagsForOpportunity(db, "tag-test-1");
  assert.equal(tagsAfter.length, 1);
  assert.equal(tagsAfter[0].tag_value, "node.js");

  db.close();
  cleanup();
});

test("recordOutcome persists and updates pursuit_status", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  const opp = makeOpp({ noticeId: "outcome-test-1" });
  await upsertOpportunity(db, opp, "", "", "h1", new Date().toISOString(), { logger: mockLogger });

  await recordOutcome(db, "outcome-test-1", {
    result: "won",
    awardAmount: 150000,
    whatWorked: "Strong tech proposal",
  });

  const outcome = await new Promise((resolve, reject) => {
    db.get("SELECT * FROM outcomes WHERE notice_id = ?", ["outcome-test-1"], (err, row) => err ? reject(err) : resolve(row));
  });
  assert.equal(outcome.result, "won");
  assert.equal(outcome.award_amount, 150000);
  assert.equal(outcome.what_worked, "Strong tech proposal");

  // Check pursuit_status was updated
  const oppRow = await new Promise((resolve, reject) => {
    db.get("SELECT pursuit_status FROM opportunities WHERE notice_id = ?", ["outcome-test-1"], (err, row) => err ? reject(err) : resolve(row));
  });
  assert.equal(oppRow.pursuit_status, "won");

  db.close();
  cleanup();
});

test("queryOpportunities supports composable filters", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  // Insert test opportunities
  const opps = [
    makeOpp({ noticeId: "q1", title: "IT Services", naicsCode: "541519", setAside: "SDVOSB" }),
    makeOpp({ noticeId: "q2", title: "Construction", naicsCode: "236220", setAside: "SBA" }),
    makeOpp({ noticeId: "q3", title: "Logistics Software", naicsCode: "541519", setAside: "SDVOSB" }),
  ];
  for (const opp of opps) {
    await upsertOpportunity(db, opp, "", "", "h", new Date().toISOString(), { logger: mockLogger });
  }
  await saveScore(db, "q1", { fit_label: "GOOD_FIT", fit_score: 85, confidence: 0.9, is_relevant: true, plain_english_summary: "test", reasons: [], risks: [], required_skillsets: [], key_dates: { due_date: "", other_dates: [] }, attachment_summary: "", must_check_items: [] }, new Date().toISOString());
  await saveScore(db, "q2", { fit_label: "NOT_A_FIT", fit_score: 20, confidence: 0.8, is_relevant: false, plain_english_summary: "test", reasons: [], risks: [], required_skillsets: [], key_dates: { due_date: "", other_dates: [] }, attachment_summary: "", must_check_items: [] }, new Date().toISOString());
  await saveScore(db, "q3", { fit_label: "MAYBE", fit_score: 55, confidence: 0.7, is_relevant: true, plain_english_summary: "test", reasons: [], risks: [], required_skillsets: [], key_dates: { due_date: "", other_dates: [] }, attachment_summary: "", must_check_items: [] }, new Date().toISOString());

  // Filter by score
  const high = await queryOpportunities(db, { minScore: 60 });
  assert.equal(high.length, 1);
  assert.equal(high[0].notice_id, "q1");

  // Filter by NAICS
  const naics = await queryOpportunities(db, { naics: "541519" });
  assert.equal(naics.length, 2);

  // Filter by label
  const good = await queryOpportunities(db, { fitLabel: "GOOD_FIT" });
  assert.equal(good.length, 1);

  // Filter by set-aside
  const sdv = await queryOpportunities(db, { setAside: "SDVOSB" });
  assert.equal(sdv.length, 2);

  // Combined filters
  const combined = await queryOpportunities(db, { naics: "541519", minScore: 60 });
  assert.equal(combined.length, 1);

  db.close();
  cleanup();
});

test("getFullOpportunity includes tags, events, and outcome", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  const opp = makeOpp({ noticeId: "full-test-1" });
  await upsertOpportunity(db, opp, "description text", "", "h1", new Date().toISOString(), { logger: mockLogger });
  await saveScore(db, "full-test-1", { fit_label: "GOOD_FIT", fit_score: 80, confidence: 0.9, is_relevant: true, plain_english_summary: "Full test", reasons: ["reason1"], risks: ["risk1"], required_skillsets: ["skill1"], key_dates: { due_date: "2026-02-15", other_dates: [] }, attachment_summary: "none", must_check_items: ["check1"] }, new Date().toISOString());
  await updatePursuitStatus(db, "full-test-1", "interested");
  await addTag(db, "full-test-1", "capability", "automation");
  await addPursuitEvent(db, "full-test-1", { eventType: "note", description: "test note" });

  const full = await getFullOpportunity(db, "full-test-1");
  assert.ok(full);
  assert.equal(full.title, "Test Opportunity");
  assert.equal(full.ai_summary, "Full test");
  assert.equal(full.pursuit_status, "interested");
  assert.equal(full.tags.length, 1);
  assert.equal(full.tags[0].tag_value, "automation");
  assert.ok(full.events.length >= 2); // status change + note
  assert.equal(full.outcome, undefined);

  db.close();
  cleanup();
});

test("getPipelineStats groups by pursuit_status", async () => {
  cleanup();
  const db = await initStorage(TEST_DB);

  for (let i = 0; i < 5; i++) {
    const opp = makeOpp({ noticeId: `pipe-${i}` });
    await upsertOpportunity(db, opp, "", "", "h", new Date().toISOString(), { logger: mockLogger });
    await saveScore(db, `pipe-${i}`, { fit_label: "GOOD_FIT", fit_score: 70 + i, confidence: 0.8, is_relevant: true, plain_english_summary: "", reasons: [], risks: [], required_skillsets: [], key_dates: { due_date: "", other_dates: [] }, attachment_summary: "", must_check_items: [] }, new Date().toISOString());
  }
  await updatePursuitStatus(db, "pipe-0", "reviewing");
  await updatePursuitStatus(db, "pipe-1", "reviewing");
  await updatePursuitStatus(db, "pipe-2", "interested");

  const stats = await getPipelineStats(db);
  const reviewing = stats.find(s => s.pursuit_status === "reviewing");
  const interested = stats.find(s => s.pursuit_status === "interested");

  assert.ok(reviewing);
  assert.equal(reviewing.count, 2);
  assert.ok(interested);
  assert.equal(interested.count, 1);

  db.close();
  cleanup();
});
