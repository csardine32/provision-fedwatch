// ============================================================
// Deadline Email Alerts
// Queries Supabase for upcoming deadlines, sends via Resend
// Dedup via email_alerts table (one alert per project per tier)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// TODO: After verifying provisionsunlimited.net domain in Resend,
// switch to csardine@provisionsunlimited.net and jsardine@provisionsunlimited.net
const RECIPIENTS = [
  "csardine32@gmail.com",
];

// Alert tiers: check 7-day, 3-day, and 1-day windows
const ALERT_TIERS = [
  { type: "7day", days: 7, label: "7 days" },
  { type: "3day", days: 3, label: "3 days" },
  { type: "1day", days: 1, label: "1 day" },
];

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY required");
  }
  return createClient(url, key);
}

function formatDeadline(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function buildEmailHtml(project, tier) {
  const deadline = formatDeadline(project.response_deadline);
  const owner = project.owner || "Unassigned";
  const agency = project.agency || "";
  const solicitation = project.solicitation_number || "";
  const samLink = project.sam_link || "";

  const urgencyColor = tier.days <= 1 ? "#dc2626" : tier.days <= 3 ? "#ea580c" : "#d97706";

  return `
    <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0b1d35; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 1px;">
          PROVISIONS <span style="font-weight: 300; opacity: 0.7;">DEADLINE ALERT</span>
        </h1>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <div style="background: ${urgencyColor}; color: white; display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 700; margin-bottom: 16px;">
          DUE IN ${tier.label.toUpperCase()}
        </div>
        <h2 style="margin: 0 0 16px; color: #0b1d35; font-size: 20px;">${project.title}</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; width: 120px;">Deadline</td>
            <td style="padding: 8px 0; color: #0b1d35; font-weight: 600;">${deadline}</td>
          </tr>
          ${agency ? `<tr><td style="padding: 8px 0; color: #6b7280;">Agency</td><td style="padding: 8px 0;">${agency}</td></tr>` : ""}
          ${solicitation ? `<tr><td style="padding: 8px 0; color: #6b7280;">Solicitation</td><td style="padding: 8px 0;">${solicitation}</td></tr>` : ""}
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Owner</td>
            <td style="padding: 8px 0;">${owner}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Priority</td>
            <td style="padding: 8px 0; text-transform: capitalize;">${project.priority || "normal"}</td>
          </tr>
        </table>
        ${samLink ? `<div style="margin-top: 16px;"><a href="${samLink}" style="color: #2563eb; text-decoration: none; font-size: 14px;">View on SAM.gov &rarr;</a></div>` : ""}
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          <a href="https://dashboard.provisionsunlimited.net/dashboard" style="display: inline-block; background: #0b1d35; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Open Dashboard
          </a>
        </div>
      </div>
    </div>`;
}

export async function sendDeadlineAlerts({ dryRun = false, verbose = false } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[alerts] RESEND_API_KEY not set, skipping email alerts");
    return { sent: 0, skipped: 0 };
  }

  const sb = getSupabase();
  const resend = new Resend(apiKey);
  const now = new Date();
  let sent = 0;
  let skipped = 0;

  // Fetch active projects with upcoming deadlines
  const { data: projects, error } = await sb
    .from("projects")
    .select("*")
    .eq("status", "active")
    .gte("response_deadline", now.toISOString())
    .order("response_deadline", { ascending: true });

  if (error) {
    console.error("[alerts] Failed to fetch projects:", error.message);
    return { sent: 0, skipped: 0, error: error.message };
  }

  if (verbose) console.log(`[alerts] Found ${projects.length} active projects with future deadlines`);

  // Fetch existing alerts for dedup
  const { data: existingAlerts } = await sb
    .from("email_alerts")
    .select("project_id, alert_type");

  const alertSet = new Set(
    (existingAlerts || []).map((a) => `${a.project_id}:${a.alert_type}`)
  );

  for (const project of projects) {
    const deadline = new Date(project.response_deadline);
    const daysUntil = (deadline - now) / (1000 * 60 * 60 * 24);

    for (const tier of ALERT_TIERS) {
      // Only send if within the tier window
      if (daysUntil > tier.days) continue;

      const key = `${project.id}:${tier.type}`;
      if (alertSet.has(key)) {
        if (verbose) console.log(`[alerts] Already sent ${tier.type} for "${project.title}", skipping`);
        skipped++;
        continue;
      }

      const subject = `[DEADLINE] ${project.title} due in ${tier.label}`;
      const html = buildEmailHtml(project, tier);

      if (dryRun) {
        console.log(`[alerts] DRY RUN — Would send: ${subject} to ${RECIPIENTS.join(", ")}`);
        sent++;
        continue;
      }

      try {
        const { error: sendError } = await resend.emails.send({
          from: "Provisions Alerts <onboarding@resend.dev>",
          to: RECIPIENTS,
          subject,
          html,
        });

        if (sendError) {
          console.error(`[alerts] Failed to send ${tier.type} for "${project.title}":`, sendError.message);
          continue;
        }

        // Record in dedup table
        await sb.from("email_alerts").insert({
          project_id: project.id,
          alert_type: tier.type,
          recipient: RECIPIENTS.join(", "),
        });

        console.log(`[alerts] Sent: ${subject}`);
        sent++;
      } catch (err) {
        console.error(`[alerts] Error sending ${tier.type} for "${project.title}":`, err.message);
      }
    }
  }

  console.log(`[alerts] Done — ${sent} sent, ${skipped} already sent`);
  return { sent, skipped };
}

export async function handleAlerts(flags) {
  const dryRun = Boolean(flags.get("dry-run"));
  const verbose = Boolean(flags.get("verbose"));
  await sendDeadlineAlerts({ dryRun, verbose });
}
