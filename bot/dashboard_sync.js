// ============================================================
// Dashboard Sync — Push FedWatch opportunities to Supabase
// Used when status changes to "pursuing" or for manual sync
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { getFullOpportunity } from "./storage.js";

// Standard milestone template (days before deadline)
const MILESTONE_TEMPLATE = [
  { title: "Questions Due", daysBeforeDeadline: 10 },
  { title: "Team Assignments", daysBeforeDeadline: 8 },
  { title: "Draft Complete", daysBeforeDeadline: 5 },
  { title: "Internal Review", daysBeforeDeadline: 3 },
  { title: "Final Edits", daysBeforeDeadline: 2 },
  { title: "Final Submit", daysBeforeDeadline: 0 },
];

// Standard document checklist
const DEFAULT_CHECKLIST = [
  "Capability Statement",
  "Past Performance References",
  "Technical Approach",
  "Price/Cost Proposal",
  "SAM.gov Registration Verified",
  "Subcontracting Plan (if applicable)",
];

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables. " +
      "Set them in your .env file to enable dashboard sync."
    );
  }

  return createClient(url, key);
}

/**
 * Sync an opportunity to the Supabase dashboard.
 * Creates the project with auto-generated milestones and checklist.
 * If the project already exists (by notice_id), updates it instead.
 */
export async function syncToDashboard(db, noticeId, { logger = console } = {}) {
  const supabase = getSupabaseClient();
  const opp = await getFullOpportunity(db, noticeId);

  if (!opp) {
    logger.error(`[dashboard-sync] Opportunity "${noticeId}" not found in local database.`);
    return { synced: false, reason: "not_found" };
  }

  // Check if project already exists on dashboard
  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("notice_id", opp.notice_id)
    .maybeSingle();

  if (existing) {
    // Update existing project
    const updates = {
      title: opp.title,
      agency: opp.agency_short || opp.agency,
      solicitation_number: opp.solicitation_number,
      response_deadline: opp.response_deadline,
      naics_code: opp.naics_code,
      set_aside: opp.set_aside,
      sam_link: opp.ui_link,
    };

    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", existing.id);

    if (error) {
      logger.error(`[dashboard-sync] Failed to update project:`, error.message);
      return { synced: false, reason: "update_failed" };
    }

    logger.log(`[dashboard-sync] Updated existing dashboard project for "${opp.title}".`);
    return { synced: true, projectId: existing.id, action: "updated" };
  }

  // Create new project
  const projectData = {
    title: opp.title,
    agency: opp.agency_short || opp.agency,
    solicitation_number: opp.solicitation_number,
    notice_id: opp.notice_id,
    response_deadline: opp.response_deadline,
    owner: "Chris",
    status: "active",
    priority: opp.priority >= 3 ? "high" : "normal",
    naics_code: opp.naics_code,
    set_aside: opp.set_aside,
    sam_link: opp.ui_link,
    notes: opp.ai_summary || null,
  };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert(projectData)
    .select()
    .single();

  if (projectError) {
    logger.error(`[dashboard-sync] Failed to create project:`, projectError.message);
    return { synced: false, reason: "create_failed" };
  }

  // Auto-generate milestones from deadline
  if (opp.response_deadline) {
    const deadlineDate = new Date(opp.response_deadline);
    const milestones = MILESTONE_TEMPLATE.map((m, i) => {
      const dueDate = new Date(deadlineDate);
      dueDate.setDate(dueDate.getDate() - m.daysBeforeDeadline);
      return {
        project_id: project.id,
        title: m.title,
        due_date: dueDate.toISOString(),
        sort_order: i,
      };
    });

    const { error: mError } = await supabase.from("milestones").insert(milestones);
    if (mError) logger.error(`[dashboard-sync] Failed to create milestones:`, mError.message);
  }

  // Auto-generate document checklist
  const checklistItems = DEFAULT_CHECKLIST.map((label, i) => ({
    project_id: project.id,
    label,
    sort_order: i,
  }));

  const { error: cError } = await supabase.from("checklist_items").insert(checklistItems);
  if (cError) logger.error(`[dashboard-sync] Failed to create checklist:`, cError.message);

  // Log activity
  await supabase.from("activity_log").insert({
    project_id: project.id,
    action: "Synced from FedWatch",
    details: `notice_id: ${opp.notice_id}, score: ${opp.last_score}, label: ${opp.last_fit_label}`,
  });

  logger.log(`[dashboard-sync] Created dashboard project for "${opp.title}" with milestones and checklist.`);
  return { synced: true, projectId: project.id, action: "created" };
}

/**
 * Update dashboard project status when FedWatch status changes
 * to a terminal status (won, lost, no_bid, expired).
 */
export async function syncStatusToDashboard(noticeId, newStatus, { logger = console } = {}) {
  const supabase = getSupabaseClient();

  const statusMap = {
    won: "won",
    lost: "lost",
    no_bid: "no_bid",
    expired: "archived",
  };

  const dashboardStatus = statusMap[newStatus];
  if (!dashboardStatus) return;

  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("notice_id", noticeId)
    .maybeSingle();

  if (!existing) return;

  const { error } = await supabase
    .from("projects")
    .update({ status: dashboardStatus })
    .eq("id", existing.id);

  if (error) {
    logger.error(`[dashboard-sync] Failed to update status:`, error.message);
    return;
  }

  await supabase.from("activity_log").insert({
    project_id: existing.id,
    action: `Status changed to ${newStatus}`,
    details: `Synced from FedWatch CLI`,
  });

  logger.log(`[dashboard-sync] Updated dashboard project status to "${dashboardStatus}".`);
}

/**
 * Manual sync command — sync a specific opportunity by notice_id
 */
export async function handleDashboardSync(db, noticeId, { logger = console } = {}) {
  if (!noticeId) {
    logger.log('Usage: node bot/cli.js dashboard-sync <notice_id>');
    logger.log('Syncs an opportunity to the Supabase deadline dashboard.');
    return;
  }

  try {
    const result = await syncToDashboard(db, noticeId, { logger });
    if (result.synced) {
      logger.log(`Dashboard sync complete (${result.action}). Project ID: ${result.projectId}`);
    } else {
      logger.error(`Dashboard sync failed: ${result.reason}`);
    }
  } catch (err) {
    if (err.message.includes("SUPABASE_URL")) {
      logger.error(err.message);
    } else {
      logger.error(`[dashboard-sync] Error:`, err.message);
    }
  }
}
