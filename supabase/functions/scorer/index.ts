import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are an elite Federal Contracting Analyst and Capture Strategist for a small, high-skill software & AI consultancy named ProVision Systems.

Company profile (what we DO):
- custom software development and web apps
- AI / ML (LLMs, analytics, decision support, classification, NLP, etc.)
- data engineering, ETL, pipelines, dashboards, BI, reporting
- cloud-native development (AWS, Azure, GCP), APIs, microservices
- DevSecOps and modernization of legacy systems
- workflow automation, integration, backend systems
- realistic project size sweet spot: ~$50K–$5M

What we do NOT want:
- construction, facilities, janitorial, landscaping, waste
- heavy equipment, vehicles, PPE, furniture, general supplies, spare parts
- medical/clinical staffing or direct healthcare providers
- manufacturing, warehouse-only logistics
- pure basic research with no concrete software/data deliverables
- hardware/weapon systems where software is incidental

Your task: score SAM.gov notices for relevance to ProVision. Be conservative and realistic about win probability for a small expert shop.

Scoring (0–100):
- 90–100: Perfect fit. Software/data/AI central. Size realistic. Plausible competitive position.
- 70–89: Strong relevance. Major software/data/automation component. Worth serious attention.
- 50–69: Some overlap but not core. IT/software present but secondary or mixed with non-core work.
- 30–49: Weak relevance. IT/software marginal or unclear; likely not worth effort.
- 0–29: Not a software/data opportunity; ignore.

Always punish with scores < 40:
- motors, switches, pumps, valves, plumbing, HVAC, construction
- vehicle/aircraft/ship parts, weapons, ammo
- janitorial/landscaping/waste/food service
- generic hardware/software renewals with no engineering

Return ONLY a JSON object:
{
  "score": number,              // 0–100
  "reason": string,             // 2–4 sentences grounded in notice details
  "tags": string[],             // short labels like "AI/ML", "data engineering", "low relevance"
  "estimated_value": string,    // "micro (<$25k)" | "small ($25k–250k)" | "mid ($250k–5M)" | "large ($5M+)" | "unknown"
  "effort_level": string,       // "very low" | "low" | "medium" | "high"
  "action": string              // one concrete next step
}
`;

type RawNotice = {
  id: string;
  sam_notice_id: string | null;
  data: unknown;
  created_at: string;
};

type ScoredResult = {
  sam_notice_id: string;
  sam_data: unknown;
  score: number;
  result: unknown;
};

async function fetchUnprocessed(limit = 10): Promise<RawNotice[]> {
  const { data, error } = await supabase
    .from("notices_raw")
    .select("id, sam_notice_id, data, created_at")
    .not("sam_notice_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    console.error("Error fetching notices_raw:", error);
    throw error;
  }
  if (!data?.length) return [];

  const samIds = Array.from(new Set(data.map((r) => r.sam_notice_id!).filter(Boolean)));
  const processedSet = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < samIds.length; i += CHUNK) {
    const chunk = samIds.slice(i, i + CHUNK);
    const { data: processed, error: perr } = await supabase
      .from("notices_processed")
      .select("sam_notice_id")
      .in("sam_notice_id", chunk);
    if (perr) {
      console.error("Error fetching notices_processed:", perr);
      throw perr;
    }
    for (const row of processed ?? []) {
      if (row.sam_notice_id) processedSet.add(row.sam_notice_id);
    }
  }

  const out: RawNotice[] = [];
  const seen = new Set<string>();
  for (const r of data) {
    const sid = r.sam_notice_id!;
    if (processedSet.has(sid)) continue;
    if (seen.has(sid)) continue;
    seen.add(sid);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function stripCodeFences(s: string) {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

async function scoreNotice(notice: RawNotice): Promise<ScoredResult | null> {
  if (!notice.sam_notice_id) return null;
  const input = { sam_notice_id: notice.sam_notice_id, raw: notice.data };

  let response;
  try {
    response = await openai.responses.create({
      model: "gpt-4.1-mini",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sam_notice_scoring",
          schema: {
            type: "object",
            properties: {
              score: { type: "number" },
              reason: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              estimated_value: { type: "string" },
              effort_level: { type: "string" },
              action: { type: "string" },
            },
            required: ["score", "reason", "tags", "estimated_value", "effort_level", "action"],
            additionalProperties: true,
          },
          strict: true,
        },
      },
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Analyze this SAM.gov notice according to your instructions and return ONLY the JSON object described.\n\n" +
            JSON.stringify(input, null, 2),
        },
      ],
    });
  } catch (err) {
    console.error("OpenAI API error for notice", notice.sam_notice_id, err);
    return null;
  }

  let parsed: any;
  try {
    const contentItem = (response as any)?.output?.[0]?.content?.[0];
    if (!contentItem || contentItem.type !== "output_json") {
      console.error("Unexpected OpenAI content format:", response);
      return null;
    }
    parsed = contentItem.output_json;
  } catch (e) {
    console.error("Failed to parse OpenAI response JSON", e, response);
    return null;
  }

  if (!parsed || typeof parsed.score !== "number") {
    console.error("Model response missing valid score", parsed);
    return null;
  }

  return {
    sam_notice_id: notice.sam_notice_id,
    sam_data: notice.data,
    score: parsed.score,
    result: parsed,
  };
}

async function upsertProcessed(results: ScoredResult[]) {
  if (results.length === 0) return;
  const rows = results.map((r) => ({ sam_notice_id: r.sam_notice_id, sam_data: r.sam_data, score: r.score, result: r.result }));
  const { error } = await supabase.from("notices_processed").upsert(rows, { onConflict: "sam_notice_id" });
  if (error) {
    console.error("Error upserting into notices_processed:", error);
    throw error;
  }
}

serve(async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const limitParam = new URL(req.url).searchParams.get("limit");
    const n = Number(limitParam);
    const limit = Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 10;

    const toScore = await fetchUnprocessed(limit);
    if (toScore.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No unprocessed notices found" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const scored: ScoredResult[] = [];
    for (const notice of toScore) {
      try {
        const result = await scoreNotice(notice);
        if (result) scored.push(result);
      } catch (err) {
        console.error("Error scoring notice", { sam_notice_id: notice.sam_notice_id, err });
      }
    }

    await upsertProcessed(scored);

    return new Response(
      JSON.stringify({ requested_limit: limit, seen_raw_notices: toScore.length, processed: scored.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error in scorer function:", err);
    return new Response(JSON.stringify({ error: "Internal error in scorer function" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
