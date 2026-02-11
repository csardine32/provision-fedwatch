import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// Base64 encode using built-in btoa
function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ANALYSIS_PROMPT = `Analyze this solicitation document thoroughly and return a JSON object with the following structure. Be specific and detailed — this analysis helps a small business decide whether to bid.

{
  "scope_of_work": "Detailed paragraph describing what the government is buying",
  "key_requirements": ["requirement 1", "requirement 2", ...],
  "required_qualifications": ["certification or qualification 1", ...],
  "period_of_performance": "e.g., 1 base year + 4 option years",
  "evaluation_criteria": ["criterion 1 (weight if stated)", ...],
  "compliance_requirements": ["FAR clause or compliance item", ...],
  "red_flags": ["concern 1", ...],
  "bid_readiness": "Paragraph describing what a small IT/software company would need to prepare to win this"
}

Return ONLY valid JSON. No markdown, no code fences.`;

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { notice_id } = await req.json();
    if (!notice_id) {
      return new Response(JSON.stringify({ error: "notice_id is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Look up the opportunity
    const { data: opp, error: fetchErr } = await supabase
      .from("scanner_opportunities")
      .select("notice_id, resource_links_json, attachment_analysis_json")
      .eq("notice_id", notice_id)
      .single();

    if (fetchErr || !opp) {
      return new Response(JSON.stringify({ error: "Opportunity not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // If already analyzed, return cached result
    if (opp.attachment_analysis_json) {
      return new Response(JSON.stringify({
        notice_id,
        analysis: JSON.parse(opp.attachment_analysis_json),
        cached: true,
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Parse resource links — may be strings or {href, name} objects
    let rawLinks: unknown[] = [];
    if (opp.resource_links_json) {
      try {
        rawLinks = JSON.parse(opp.resource_links_json);
      } catch {
        // ignore parse errors
      }
    }

    // Normalize to {href, name} format
    const resourceLinks = (rawLinks || []).map((l: unknown) => {
      if (typeof l === "string") return { href: l, name: "" };
      if (l && typeof l === "object" && "href" in (l as Record<string, unknown>)) return l as { href: string; name?: string };
      return null;
    }).filter((l): l is { href: string; name?: string } => l !== null && Boolean(l.href));

    if (resourceLinks.length === 0) {
      return new Response(JSON.stringify({ error: "No attachments available for this opportunity" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Prefer PDF links, then any /download link
    const docLink = resourceLinks.find((l) => {
      const href = (l.href || "").toLowerCase();
      const name = (l.name || "").toLowerCase();
      return href.endsWith(".pdf") || name.endsWith(".pdf");
    }) || resourceLinks.find((l) => {
      return (l.href || "").includes("/download");
    }) || resourceLinks[0];

    // Download the document
    console.log(`Downloading attachment: ${docLink.href}`);
    const docResponse = await fetch(docLink.href, {
      headers: { "User-Agent": "ProVision-FedWatch/1.0" },
    });

    if (!docResponse.ok) {
      return new Response(JSON.stringify({
        error: `Failed to download attachment: ${docResponse.status} ${docResponse.statusText}`,
      }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const docBytes = new Uint8Array(await docResponse.arrayBuffer());
    const docBase64 = base64Encode(docBytes);

    // Determine MIME type from response content-type or URL
    const responseContentType = docResponse.headers.get("content-type") || "";
    const finalUrl = docResponse.url || docLink.href;

    let mediaType = "application/pdf";
    if (responseContentType.includes("wordprocessing") || responseContentType.includes("msword") ||
        finalUrl.includes(".docx") || docLink.href.includes(".docx")) {
      // Claude doesn't support DOCX — only PDF for documents
      return new Response(JSON.stringify({
        error: "Solicitation documents are in DOCX format. PDF analysis only is supported. Open the document from SAM.gov for manual review.",
      }), {
        status: 422,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Send to Claude Sonnet via Anthropic Messages API
    console.log(`Sending ${docBytes.length} bytes to Claude Sonnet for analysis`);
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: mediaType,
                data: docBase64,
              },
            },
            {
              type: "text",
              text: ANALYSIS_PROMPT,
            },
          ],
        }],
        system: "You are a federal contracting analyst. You provide thorough, accurate analysis of government solicitation documents to help small businesses make bid/no-bid decisions.",
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errText);
      return new Response(JSON.stringify({
        error: `Claude API error: ${claudeResponse.status}`,
      }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData?.content?.[0]?.text;

    if (!rawText) {
      console.error("No text in Claude response:", JSON.stringify(claudeData));
      return new Response(JSON.stringify({ error: "Claude returned no analysis text" }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Parse the analysis JSON
    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(stripCodeFences(rawText));
    } catch {
      console.error("Failed to parse Claude JSON:", rawText);
      // Store raw text as fallback
      analysis = { raw_analysis: rawText };
    }

    // Store in Supabase
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("scanner_opportunities")
      .update({
        attachment_analysis_json: JSON.stringify(analysis),
        attachment_analyzed_at: nowIso,
      })
      .eq("notice_id", notice_id);

    if (updateErr) {
      console.error("Failed to store analysis:", updateErr);
    }

    return new Response(JSON.stringify({
      notice_id,
      analysis,
      cached: false,
      analyzed_at: nowIso,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
