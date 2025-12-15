import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATABASE_URL = Deno.env.get("DATABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("ANON_KEY") ?? "";

const supabase = createClient(DATABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

async function runNotifier(): Promise<Response> {
  if (!DATABASE_URL || (!SERVICE_ROLE_KEY && !ANON_KEY)) {
    console.error("Notifier: missing env vars");
    return new Response(JSON.stringify({ ok: false, error: "Server not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1) Fetch unsent alerts
  const { data: alerts, error: fetchError } = await supabase
    .from("alerts")
    .select("id, sam_notice_id, payload, channel, created_at")
    .eq("sent", false)
    .order("created_at", { ascending: true })
    .limit(50);

  if (fetchError) {
    console.error("Notifier: error fetching alerts", fetchError);
    return new Response(JSON.stringify({ ok: false, error: "DB error", details: fetchError }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!alerts || alerts.length === 0) {
    console.log("Notifier: no pending alerts");
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`Notifier: processing ${alerts.length} alerts`);

  const sentIds: string[] = [];

  for (const alert of alerts) {
    const { id, sam_notice_id, payload, channel } = alert as {
      id: string;
      sam_notice_id: string;
      payload: unknown;
      channel: string | null;
    };

    try {
      // TODO: replace this with email / Slack / etc.
      console.log("Notifier: would send alert", {
        id,
        sam_notice_id,
        channel: channel ?? "default",
      });

      sentIds.push(id);
    } catch (err) {
      console.error("Notifier: error sending alert", id, err);
    }
  }

  // 3) Mark successfully handled alerts as sent
  if (sentIds.length > 0) {
    const { error: updateError } = await supabase.from("alerts").update({ sent: true }).in("id", sentIds);
    if (updateError) {
      console.error("Notifier: error marking alerts as sent", updateError);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent: sentIds.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve((_req) => runNotifier());
