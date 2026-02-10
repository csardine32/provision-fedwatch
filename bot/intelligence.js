import {
  queryOpportunities,
  getFullOpportunity,
  getPipelineStats,
  getAgencyStats,
  getNaicsStats,
  getSetAsideStats,
  getWinLossStats,
  updatePursuitStatus,
  addPursuitEvent,
  addTag,
  removeTag,
  recordOutcome,
  VALID_STATUSES,
} from "./storage.js";
import { syncToDashboard, syncStatusToDashboard } from "./dashboard_sync.js";

// --- Formatters ---

function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len - 1) + "\u2026" : str;
}

function padRight(str, len) {
  const s = String(str || "");
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeft(str, len) {
  const s = String(str || "");
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function formatScore(score) {
  if (score == null) return "  --";
  return padLeft(Math.round(score).toString(), 4);
}

function formatDeadline(deadline) {
  if (!deadline) return "No deadline";
  const d = new Date(deadline);
  if (isNaN(d)) return deadline;
  const now = new Date();
  const daysLeft = Math.ceil((d - now) / 86400000);
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (daysLeft < 0) return `${dateStr} (PASSED)`;
  if (daysLeft === 0) return `${dateStr} (TODAY)`;
  if (daysLeft <= 3) return `${dateStr} (${daysLeft}d!)`;
  return `${dateStr} (${daysLeft}d)`;
}

function labelColor(label) {
  if (label === "GOOD_FIT") return "\x1b[32m";  // green
  if (label === "MAYBE") return "\x1b[33m";      // yellow
  if (label === "NOT_A_FIT") return "\x1b[31m";  // red
  return "\x1b[0m";
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// --- Query command ---

export async function handleQuery(db, filters) {
  const rows = await queryOpportunities(db, { ...filters, limit: filters.limit || 25 });

  if (rows.length === 0) {
    console.log("No opportunities match the given filters.");
    return;
  }

  console.log(`\n${BOLD}Found ${rows.length} opportunities${RESET}\n`);
  console.log(
    `${DIM}${padRight("Score", 6)} ${padRight("Label", 10)} ${padRight("Status", 12)} ${padRight("Set-Aside", 10)} ${padRight("Agency", 22)} ${padRight("Deadline", 18)} Title${RESET}`
  );
  console.log("-".repeat(120));

  for (const row of rows) {
    const color = labelColor(row.last_fit_label);
    console.log(
      `${formatScore(row.last_score)}  ${color}${padRight(row.last_fit_label || "--", 10)}${RESET} ${padRight(row.pursuit_status || "discovered", 12)} ${padRight(truncate(row.set_aside, 10), 10)} ${padRight(truncate(row.agency_short, 22), 22)} ${padRight(formatDeadline(row.response_deadline), 18)} ${truncate(row.title, 50)}`
    );
  }

  console.log(`\n${DIM}Use "node bot/cli.js show <notice_id>" for full details${RESET}`);
}

// --- Show command ---

export async function handleShow(db, noticeId) {
  const opp = await getFullOpportunity(db, noticeId);
  if (!opp) {
    console.log(`No opportunity found for "${noticeId}".`);
    return;
  }

  const color = labelColor(opp.last_fit_label);
  console.log(`\n${BOLD}${opp.title}${RESET}`);
  console.log("=".repeat(Math.min(opp.title.length, 80)));

  console.log(`
${BOLD}Identifiers${RESET}
  Notice ID:      ${opp.notice_id}
  Solicitation:   ${opp.solicitation_number || "--"}
  NAICS:          ${opp.naics_code || "--"}
  Classification: ${opp.classification_code || "--"}
  SAM Link:       ${opp.ui_link || "--"}

${BOLD}Details${RESET}
  Agency:         ${opp.agency_short || opp.agency || "--"}
  Set-Aside:      ${opp.set_aside || "--"}
  Posted:         ${opp.posted_date || "--"}
  Deadline:       ${formatDeadline(opp.response_deadline)}
  Status:         ${opp.pursuit_status || "discovered"}
  Priority:       ${opp.priority || 0}

${BOLD}AI Assessment${RESET}
  Score:          ${color}${opp.last_score ?? "--"} (${opp.last_fit_label || "--"})${RESET}
  Relevant:       ${opp.ai_is_relevant == null ? "--" : (opp.ai_is_relevant ? "Yes" : "No")}
  Scored At:      ${opp.last_scored_at || "Not scored"}`);

  if (opp.ai_summary) {
    console.log(`\n${BOLD}Summary${RESET}\n  ${opp.ai_summary}`);
  }

  if (opp.ai_reasons_json) {
    const reasons = JSON.parse(opp.ai_reasons_json);
    if (reasons.length > 0) {
      console.log(`\n${BOLD}Reasons${RESET}`);
      for (const r of reasons) console.log(`  + ${r}`);
    }
  }

  if (opp.ai_risks_json) {
    const risks = JSON.parse(opp.ai_risks_json);
    if (risks.length > 0) {
      console.log(`\n${BOLD}Risks${RESET}`);
      for (const r of risks) console.log(`  - ${r}`);
    }
  }

  if (opp.ai_skillsets_json) {
    const skills = JSON.parse(opp.ai_skillsets_json);
    if (skills.length > 0) {
      console.log(`\n${BOLD}Required Skillsets${RESET}`);
      for (const s of skills) console.log(`  * ${s}`);
    }
  }

  if (opp.ai_key_dates_json) {
    const dates = JSON.parse(opp.ai_key_dates_json);
    console.log(`\n${BOLD}Key Dates${RESET}`);
    if (dates.due_date) console.log(`  Due:   ${dates.due_date}`);
    if (dates.other_dates?.length > 0) {
      for (const d of dates.other_dates) console.log(`  Other: ${d}`);
    }
  }

  if (opp.ai_must_check_json) {
    const items = JSON.parse(opp.ai_must_check_json);
    if (items.length > 0) {
      console.log(`\n${BOLD}Must-Check Items${RESET}`);
      for (const item of items) console.log(`  ! ${item}`);
    }
  }

  if (opp.ai_attachment_summary) {
    console.log(`\n${BOLD}Attachment Summary${RESET}\n  ${opp.ai_attachment_summary}`);
  }

  if (opp.tags.length > 0) {
    console.log(`\n${BOLD}Tags${RESET}`);
    for (const t of opp.tags) console.log(`  [${t.tag_category}] ${t.tag_value}`);
  }

  if (opp.notes) {
    console.log(`\n${BOLD}Notes${RESET}\n  ${opp.notes}`);
  }

  if (opp.events.length > 0) {
    console.log(`\n${BOLD}Event History${RESET}`);
    for (const e of opp.events.slice(0, 10)) {
      const date = new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      console.log(`  ${DIM}${date}${RESET} ${e.description || e.event_type}`);
    }
  }

  if (opp.outcome) {
    console.log(`\n${BOLD}Outcome: ${opp.outcome.result.toUpperCase()}${RESET}`);
    if (opp.outcome.award_amount) console.log(`  Award Amount: $${opp.outcome.award_amount.toLocaleString()}`);
    if (opp.outcome.winner_name) console.log(`  Winner: ${opp.outcome.winner_name}`);
    if (opp.outcome.what_worked) console.log(`  What Worked: ${opp.outcome.what_worked}`);
    if (opp.outcome.what_didnt_work) console.log(`  What Didn't: ${opp.outcome.what_didnt_work}`);
  }

  console.log("");
}

// --- Compare command ---

export async function handleCompare(db, noticeIds) {
  if (noticeIds.length < 2) {
    console.log("Provide at least 2 notice IDs to compare.");
    return;
  }

  const opps = [];
  for (const id of noticeIds) {
    const opp = await getFullOpportunity(db, id);
    if (opp) opps.push(opp);
    else console.log(`Warning: "${id}" not found, skipping.`);
  }

  if (opps.length < 2) {
    console.log("Need at least 2 valid opportunities to compare.");
    return;
  }

  const colWidth = Math.floor((process.stdout.columns || 120 - 22) / opps.length);
  const labelWidth = 20;

  function row(label, values) {
    const labelStr = padRight(label, labelWidth);
    const valStrs = values.map(v => padRight(truncate(String(v || "--"), colWidth), colWidth));
    console.log(`${BOLD}${labelStr}${RESET} ${valStrs.join(" ")}`);
  }

  console.log(`\n${BOLD}Side-by-Side Comparison (${opps.length} opportunities)${RESET}\n`);
  console.log("-".repeat(labelWidth + (colWidth + 1) * opps.length));

  row("Title", opps.map(o => o.title));
  row("Solicitation #", opps.map(o => o.solicitation_number));
  row("Agency", opps.map(o => o.agency_short));
  row("NAICS", opps.map(o => o.naics_code));
  row("Set-Aside", opps.map(o => o.set_aside));
  row("Score", opps.map(o => o.last_score != null ? `${o.last_score} (${o.last_fit_label})` : "--"));
  row("Deadline", opps.map(o => formatDeadline(o.response_deadline)));
  row("Status", opps.map(o => o.pursuit_status || "discovered"));
  row("AI Summary", opps.map(o => o.ai_summary));

  console.log("");
}

// --- Pipeline command ---

export async function handlePipeline(db, sortBy) {
  const stats = await getPipelineStats(db);

  if (stats.length === 0) {
    console.log("No scored opportunities in the database yet.");
    return;
  }

  console.log(`\n${BOLD}Pursuit Pipeline${RESET}\n`);
  console.log(`${padRight("Status", 14)} ${padLeft("Count", 6)} ${padLeft("Avg Score", 10)} ${padLeft("Open", 6)}`);
  console.log("-".repeat(40));

  let totalCount = 0;
  for (const row of stats) {
    totalCount += row.count;
    console.log(
      `${padRight(row.pursuit_status || "discovered", 14)} ${padLeft(row.count, 6)} ${padLeft(row.avg_score ?? "--", 10)} ${padLeft(row.still_open, 6)}`
    );
  }

  console.log("-".repeat(40));
  console.log(`${padRight("Total", 14)} ${padLeft(totalCount, 6)}`);

  // Show top opportunities in active statuses
  const active = await queryOpportunities(db, { limit: 10, sortBy: sortBy || "last_score" });
  const activePursuits = active.filter(o =>
    ["reviewing", "interested", "pursuing", "submitted"].includes(o.pursuit_status)
  );

  if (activePursuits.length > 0) {
    console.log(`\n${BOLD}Active Pursuits${RESET}\n`);
    for (const opp of activePursuits) {
      const color = labelColor(opp.last_fit_label);
      console.log(
        `  ${color}${formatScore(opp.last_score)}${RESET} [${padRight(opp.pursuit_status, 10)}] ${truncate(opp.title, 55)} ${DIM}${formatDeadline(opp.response_deadline)}${RESET}`
      );
    }
  }

  console.log("");
}

// --- Status command ---

export async function handleStatus(db, noticeId, newStatus) {
  if (!noticeId || !newStatus) {
    console.log(`Usage: node bot/cli.js status <notice_id> <status>`);
    console.log(`Valid statuses: ${VALID_STATUSES.join(", ")}`);
    return;
  }

  try {
    await updatePursuitStatus(db, noticeId, newStatus);
    console.log(`Updated "${noticeId}" to status: ${newStatus}`);

    // Auto-sync to dashboard on key status changes
    if (newStatus === "pursuing") {
      try {
        const result = await syncToDashboard(db, noticeId);
        if (result.synced) {
          console.log(`Dashboard: ${result.action} project (${result.projectId})`);
        }
      } catch (err) {
        // Non-fatal — dashboard sync is optional
        if (!err.message.includes("SUPABASE_URL")) {
          console.error(`Dashboard sync failed: ${err.message}`);
        }
      }
    } else if (["won", "lost", "no_bid", "expired"].includes(newStatus)) {
      try {
        await syncStatusToDashboard(noticeId, newStatus);
      } catch (_) {
        // Non-fatal
      }
    }
  } catch (err) {
    console.error(err.message);
  }
}

// --- Note command ---

export async function handleNote(db, noticeId, noteText) {
  if (!noticeId || !noteText) {
    console.log("Usage: node bot/cli.js note <notice_id> \"Your note text\"");
    return;
  }

  await addPursuitEvent(db, noticeId, {
    eventType: "note",
    description: noteText,
    createdBy: "user",
  });
  console.log(`Note added to "${noticeId}".`);
}

// --- Tag command ---

export async function handleTag(db, noticeId, category, value) {
  if (!noticeId || !category || !value) {
    console.log("Usage: node bot/cli.js tag <notice_id> <category> <value>");
    console.log("Categories: capability, technology, industry, strategy, custom");
    return;
  }

  await addTag(db, noticeId, category, value);
  console.log(`Tagged "${noticeId}" with [${category}] ${value}`);
}

// --- Outcome command ---

export async function handleOutcome(db, noticeId, flags) {
  if (!noticeId) {
    console.log("Usage: node bot/cli.js outcome <notice_id> --result won|lost|no_bid --amount <dollars>");
    return;
  }

  const result = flags.get("result");
  if (!result) {
    console.log("--result is required. Options: won, lost, no_bid, withdrawn, cancelled, expired");
    return;
  }

  await recordOutcome(db, noticeId, {
    result,
    awardAmount: flags.get("amount") ? Number(flags.get("amount")) : null,
    awardDate: flags.get("award-date") || null,
    contractNumber: flags.get("contract") || null,
    winnerName: flags.get("winner") || null,
    winnerAmount: flags.get("winner-amount") ? Number(flags.get("winner-amount")) : null,
    debriefNotes: flags.get("debrief") || null,
    whatWorked: flags.get("what-worked") || null,
    whatDidntWork: flags.get("what-didnt") || null,
    wouldBidAgain: flags.has("would-bid-again") ? flags.get("would-bid-again") !== "false" : null,
  });

  console.log(`Outcome recorded for "${noticeId}": ${result}`);
}

// --- Stats command ---

export async function handleStats(db, flags) {
  const groupBy = flags.get("group-by") || "pipeline";

  if (groupBy === "pipeline" || groupBy === "status") {
    await handlePipeline(db);
    return;
  }

  let rows;
  let headers;

  if (groupBy === "agency") {
    rows = await getAgencyStats(db);
    headers = ["Agency", "Total", "Good Fit", "Avg Score"];
    console.log(`\n${BOLD}Opportunities by Agency${RESET}\n`);
    console.log(`${padRight(headers[0], 30)} ${padLeft(headers[1], 6)} ${padLeft(headers[2], 9)} ${padLeft(headers[3], 10)}`);
    console.log("-".repeat(58));
    for (const row of rows) {
      console.log(
        `${padRight(truncate(row.agency_short, 30), 30)} ${padLeft(row.total, 6)} ${padLeft(row.good_fit, 9)} ${padLeft(row.avg_score ?? "--", 10)}`
      );
    }
  } else if (groupBy === "naics") {
    rows = await getNaicsStats(db);
    headers = ["NAICS", "Total", "Good Fit", "Avg Score"];
    console.log(`\n${BOLD}Opportunities by NAICS Code${RESET}\n`);
    console.log(`${padRight(headers[0], 12)} ${padLeft(headers[1], 6)} ${padLeft(headers[2], 9)} ${padLeft(headers[3], 10)}`);
    console.log("-".repeat(40));
    for (const row of rows) {
      console.log(
        `${padRight(row.naics_code || "--", 12)} ${padLeft(row.total, 6)} ${padLeft(row.good_fit, 9)} ${padLeft(row.avg_score ?? "--", 10)}`
      );
    }
  } else if (groupBy === "set-aside") {
    rows = await getSetAsideStats(db);
    headers = ["Set-Aside", "Total", "Good Fit", "Avg Score"];
    console.log(`\n${BOLD}Opportunities by Set-Aside${RESET}\n`);
    console.log(`${padRight(headers[0], 20)} ${padLeft(headers[1], 6)} ${padLeft(headers[2], 9)} ${padLeft(headers[3], 10)}`);
    console.log("-".repeat(48));
    for (const row of rows) {
      console.log(
        `${padRight(truncate(row.set_aside, 20), 20)} ${padLeft(row.total, 6)} ${padLeft(row.good_fit, 9)} ${padLeft(row.avg_score ?? "--", 10)}`
      );
    }
  } else if (groupBy === "win-loss") {
    const { results, total } = await getWinLossStats(db);
    console.log(`\n${BOLD}Win/Loss Analysis${RESET}\n`);
    if (results.length === 0) {
      console.log("No outcomes recorded yet. Use 'node bot/cli.js outcome <id> --result won|lost' to start tracking.");
    } else {
      console.log(`${padRight("Result", 14)} ${padLeft("Count", 6)} ${padLeft("Avg Score", 10)} ${padLeft("Rate", 8)}`);
      console.log("-".repeat(42));
      for (const row of results) {
        const rate = total > 0 ? `${Math.round((row.count / total) * 100)}%` : "--";
        console.log(
          `${padRight(row.result, 14)} ${padLeft(row.count, 6)} ${padLeft(row.avg_score ?? "--", 10)} ${padLeft(rate, 8)}`
        );
      }
    }
  } else {
    console.log(`Unknown group-by: "${groupBy}". Options: pipeline, agency, naics, set-aside, win-loss`);
    return;
  }

  console.log("");
}
