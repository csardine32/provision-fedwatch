import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const slackWebhookUrl = Deno.env.get("SLACK_WEBHOOK_FEDWATCH_ALERTS") ?? "";
const MIN_SCORE = 70;
const RECENT_MINUTES = 90;

const supabase = createClient(supabaseUrl, supabaseKey);

function priorityFromScore(score: number | null): { label: string; emoji: string } {
  if (score === null || Number.isNaN(score)) return { label: "Unscored", emoji: "⚪️" };
  if (score >= 90) return { label: "High", emoji: "🔴" };
  if (score >= 70) return { label: "Medium", emoji: "🟠" };
  return { label: "Low", emoji: "🟢" };
}

serve(async () => {
  try {
    if (!supabaseUrl || !supabaseKey) {
      console.error("Dispatcher: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(JSON.stringify({ ok: false, reason: "missing supabase env" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!slackWebhookUrl) {
      console.error("Dispatcher: SLACK_WEBHOOK_FEDWATCH_ALERTS missing");
      return new Response(JSON.stringify({ ok: false, reason: "missing webhook" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const recentIso = new Date(Date.now() - RECENT_MINUTES * 60 * 1000).toISOString();

    const { data: candidates, error: fetchError } = await supabase
      .from("notices_processed")
      .select("id, sam_notice_id, sam_data, score, created_at")
      .not("score", "is", null)
      .gte("score", MIN_SCORE)
      .gte("created_at", recentIso)
      .order("score", { ascending: false })
      .limit(20);
    if (fetchError) throw fetchError;

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No high-score notices to alert" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ids = candidates.map((c) => c.id);
    const { data: existingAlerts, error: existingErr } = await supabase
      .from("alerts")
      .select("notice_id")
      .eq("channel", "slack")
      .in("notice_id", ids);
    if (existingErr) throw existingErr;
    const alertedIds = new Set((existingAlerts ?? []).map((a) => a.notice_id as string));

    const toSend = candidates.filter((c) => !alertedIds.has(c.id));
    if (toSend.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No unsent high-score alerts" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    const results: Array<{ id: string; status: number; body: string }> = [];

    for (const candidate of toSend) {
      const samData = (candidate as any).sam_data ?? {};
      const rawScore = candidate.score;
      const numericScore = typeof rawScore === "number" ? rawScore : Number(rawScore ?? NaN);
      const score = Number.isNaN(numericScore) ? null : numericScore;
      const { label: priorityLabel, emoji } = priorityFromScore(score);

      const title = samData.title ?? "New FedWatch Opportunity";
      const agency = samData.agency ?? "Unknown agency";
      const samNoticeId = candidate.sam_notice_id ?? "N/A";
      const description = samData.description ?? "";
      const naics = samData.naics ?? "N/A";
      const psc = samData.psc ?? "N/A";
      const dueDate = samData.due_date ?? "N/A";
      const postedDate = samData.posted_date ?? "N/A";
      const samUrl = samData.url && typeof samData.url === "string" && samData.url.startsWith("http") ? samData.url : null;
      const workspaceUrl =
        samData.workspace_url && typeof samData.workspace_url === "string" && samData.workspace_url.startsWith("http")
          ? samData.workspace_url
          : null;

      const shortDesc = description.length > 300 ? `${description.slice(0, 297)}…` : description;

      const slackBody = {
        text: `${emoji} ${title}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `${emoji} ${title}`,
              emoji: true,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Priority*\n${priorityLabel}${score !== null && !Number.isNaN(score) ? ` (${score})` : ""}`,
              },
              { type: "mrkdwn", text: `*Agency*\n${agency}` },
              { type: "mrkdwn", text: `*Notice ID*\n${samNoticeId}` },
              { type: "mrkdwn", text: `*Due*\n${dueDate}` },
            ],
          },
          ...(shortDesc
            ? [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: shortDesc },
                } as const,
              ]
            : []),
          ...(samUrl || workspaceUrl
            ? [
                {
                  type: "actions",
                  elements: [
                    ...(samUrl
                      ? [
                          {
                            type: "button",
                            text: { type: "plain_text", text: "Open in SAM.gov", emoji: true },
                            url: samUrl,
                            style: "primary",
                            action_id: "open_sam",
                            value: samNoticeId,
                          } as const,
                        ]
                      : []),
                    ...(workspaceUrl
                      ? [
                          {
                            type: "button",
                            text: { type: "plain_text", text: "Open in FedWatch", emoji: true },
                            url: workspaceUrl,
                            action_id: "open_fedwatch",
                            value: samNoticeId,
                          } as const,
                        ]
                      : []),
                  ],
                } as const,
              ]
            : []),
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `NAICS: ${naics} | PSC: ${psc} | Posted: ${postedDate}`,
              },
            ],
          },
        ],
      };

      const slackResp = await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackBody),
      });
      const slackText = await slackResp.text();

      if (!slackResp.ok) {
        console.error("Slack error", slackResp.status, slackText, slackBody);
        results.push({ id: candidate.id, status: slackResp.status, body: slackText });
        continue;
      }

      const { error: insertErr } = await supabase.from("alerts").insert({
        id: crypto.randomUUID(),
        notice_id: candidate.id,
        channel: "slack",
        payload: slackBody,
        sent: true,
      });
      if (insertErr) {
        console.error("Failed to record alert", insertErr);
        results.push({ id: candidate.id, status: slackResp.status, body: "Slack sent; DB insert failed" });
        continue;
      }

      sentCount += 1;
      results.push({ id: candidate.id, status: slackResp.status, body: slackText });
    }

    return new Response(JSON.stringify({ ok: true, sent: sentCount, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
