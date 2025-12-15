import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async () => {
  const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!webhook) {
    return new Response(JSON.stringify({ ok: false, error: "SLACK_WEBHOOK_URL not set" }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }

  const payload = {
    text: ":rotating_light: *Slack test from Supabase* :rotating_light:\nIf you see this, `slack-test` works.",
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.text().catch(() => "");

  return new Response(
    JSON.stringify({
      ok: res.ok,
      status: res.status,
      slackBody: body,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
