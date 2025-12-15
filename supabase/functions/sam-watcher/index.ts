import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATABASE_URL = Deno.env.get("DATABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("ANON_KEY") ?? "";
const SAM_API_KEY = Deno.env.get("SAM_API_KEY") ?? "";
const SAM_API_BASE = Deno.env.get("SAM_API_BASE_URL") ?? "https://api.sam.gov/opportunities/v2/search";

const supabase = createClient(DATABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

type SamApiState = {
  id: number;
  blocked_until: string | null;
  last_success: string | null;
  last_posted_to: string | null;
};

function formatSamDate(d: Date) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function postedToIso(mmddyyyy: string): string {
  const [mm, dd, yyyy] = mmddyyyy.split("/");
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).toISOString();
}

function extractNextAccessTime(text: string): string | null {
  if (!text) return null;
  const m = text.match(/\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}\+\d{4}\s+UTC/);
  return m ? m[0] : null;
}

async function fetchNotices() {
  if (!SAM_API_KEY || !DATABASE_URL || (!SERVICE_ROLE_KEY && !ANON_KEY)) {
    console.error("Missing required environment variables for SAM fetcher");
    return new Response("Server not configured", { status: 500 });
  }

  const now = new Date();

  // Read state
  const { data: state, error: stateErr } = await supabase
    .from("sam_api_state")
    .select("*")
    .eq("id", 1)
    .maybeSingle<SamApiState>();
  if (stateErr) {
    console.error("sam_api_state read error", stateErr);
  }

  if (state?.blocked_until && new Date(state.blocked_until) > now) {
    console.log("SAM.gov blocked until", state.blocked_until, "- skipping call");
    return new Response("Skipping due to SAM.gov cooldown", { status: 200 });
  }

  // Sliding window
  const postedTo = formatSamDate(now);
  let fromDate: Date;
  if (state?.last_posted_to) {
    fromDate = new Date(state.last_posted_to);
    fromDate.setUTCDate(fromDate.getUTCDate() - 1); // 1-day overlap
  } else {
    fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  const postedFrom = formatSamDate(fromDate);

  const url = new URL(SAM_API_BASE);
  url.searchParams.set("api_key", SAM_API_KEY);
  url.searchParams.set("limit", "100");
  url.searchParams.set("postedFrom", postedFrom);
  url.searchParams.set("postedTo", postedTo);

  console.log("SAM.gov request", { postedFrom, postedTo, endpoint: url.toString() });

  const res = await fetch(url.toString());
  const rawBody = await res.text();

  // Handle 429 cooldowns
  if (res.status === 429) {
    let body: any = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // ignore parse errors
    }
    const nextAccessTime = body?.nextAccessTime ?? extractNextAccessTime(body?.description ?? body?.message ?? "");
    if (nextAccessTime) {
      await supabase.from("sam_api_state").upsert({ id: 1, blocked_until: nextAccessTime });
      console.log("Updated blocked_until to", nextAccessTime);
    }
    console.error("SAM.gov quota exceeded", rawBody.slice(0, 500));
    return new Response("SAM.gov quota exceeded; will retry after cooldown", { status: 200 });
  }

  if (!res.ok) {
    console.error("SAM.gov fetch failed", res.status, rawBody.slice(0, 500));
    return new Response(`SAM.gov temporary error (status ${res.status}). See logs for details.`, { status: 200 });
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (e) {
    console.error("Failed to parse SAM.gov JSON", e, rawBody.slice(0, 500));
    return new Response("Bad SAM.gov JSON", { status: 500 });
  }

  const items = data?.opportunitiesData ?? data?.data ?? [];

  if (Array.isArray(items) && items.length) {
    const rows = items.map((item: any) => ({
      id: item.noticeId ?? crypto.randomUUID(),
      sam_notice_id: item.noticeId ?? item.notice_id ?? null,
      data: item,
    }));

    if (rows.length) {
      console.log("First record parsed:", rows[0]);
    }

    const { error } = await supabase.from("notices_raw").upsert(rows);
    if (error) {
      console.error("Supabase upsert error", error);
      return new Response("DB error", { status: 500 });
    }
  } else {
    console.log("No opportunities returned");
  }

  // Update state on success
  await supabase.from("sam_api_state").upsert({
    id: 1,
    blocked_until: null,
    last_success: now.toISOString(),
    last_posted_to: postedToIso(postedTo),
  });

  return new Response("OK");
}

Deno.serve(fetchNotices);
