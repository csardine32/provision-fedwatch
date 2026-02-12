import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ANALYSIS_PROMPT = `Analyze this solicitation document thoroughly and return a JSON object with the following structure. Be specific and detailed — this analysis helps a small business decide whether to bid.

{
  "title": "The title or subject of the solicitation",
  "solicitation_number": "The contract/solicitation number if found, or null",
  "response_deadline": "The proposal/quote/response due date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss) if found, or null",
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
    // Extract user from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { pdf_base64, text_content, filename } = await req.json();

    if (!pdf_base64 && !text_content) {
      return new Response(JSON.stringify({ error: "Either pdf_base64 or text_content is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Build content blocks based on input type
    const content: Record<string, unknown>[] = [];
    if (pdf_base64) {
      const sizeBytes = Math.ceil(pdf_base64.length * 3 / 4);
      console.log(`Analyzing ad-hoc PDF: ${filename || "unknown"} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdf_base64 },
      });
      content.push({ type: "text", text: ANALYSIS_PROMPT });
    } else {
      const textSize = new TextEncoder().encode(text_content).length;
      console.log(`Analyzing ad-hoc text: ${filename || "unknown"} (${(textSize / 1024).toFixed(1)} KB)`);
      content.push({
        type: "text",
        text: `Here is the solicitation document content:\n\n${text_content}\n\n---\n\n${ANALYSIS_PROMPT}`,
      });
    }

    // Send to Claude Sonnet via Anthropic Messages API
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
          content,
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

    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(stripCodeFences(rawText));
    } catch {
      console.error("Failed to parse Claude JSON:", rawText);
      analysis = { raw_analysis: rawText };
    }

    // Extract title and solicitation_number from analysis
    const extractedTitle = typeof analysis.title === "string" ? analysis.title : null;
    const extractedSolNum = typeof analysis.solicitation_number === "string" ? analysis.solicitation_number : null;

    const nowIso = new Date().toISOString();

    // Try to match to existing scanner opportunity by solicitation number
    let matchedOpportunity: Record<string, unknown> | null = null;
    let matchedNoticeId: string | null = null;

    if (extractedSolNum) {
      const { data: matchedOpp } = await supabase
        .from("scanner_opportunities")
        .select("notice_id, title, agency, last_score, ui_link")
        .eq("solicitation_number", extractedSolNum)
        .limit(1)
        .maybeSingle();

      if (matchedOpp) {
        matchedNoticeId = matchedOpp.notice_id;
        matchedOpportunity = matchedOpp;

        // Update the opportunity's attachment analysis
        const { error: updateErr } = await supabase
          .from("scanner_opportunities")
          .update({
            attachment_analysis_json: JSON.stringify(analysis),
            attachment_analyzed_at: nowIso,
          })
          .eq("notice_id", matchedNoticeId);

        if (updateErr) {
          console.error("Failed to update matched opportunity:", updateErr);
        }
      }
    }

    // Persist to adhoc_analyses
    const { data: inserted, error: insertErr } = await supabase
      .from("adhoc_analyses")
      .insert({
        user_id: user.id,
        filename: filename || "unknown",
        analysis_json: JSON.stringify(analysis),
        title: extractedTitle,
        solicitation_number: extractedSolNum,
        matched_notice_id: matchedNoticeId,
        analyzed_at: nowIso,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Failed to persist adhoc analysis:", insertErr);
    }

    return new Response(JSON.stringify({
      analysis,
      filename: filename || "unknown",
      analyzed_at: nowIso,
      analysis_id: inserted?.id || null,
      matched_opportunity: matchedOpportunity,
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
