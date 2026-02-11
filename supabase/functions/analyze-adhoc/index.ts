const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

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

    return new Response(JSON.stringify({
      analysis,
      filename: filename || "unknown",
      analyzed_at: new Date().toISOString(),
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
