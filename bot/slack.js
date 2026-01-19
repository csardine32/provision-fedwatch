class SlackApiError extends Error {
  constructor(message, status, text) {
    super(message);
    this.name = "SlackApiError";
    this.status = status;
    this.text = text;
  }
}

function formatFitHeader(label, title) {
  if (label === "GOOD_FIT") return `[GOOD FIT ✅] ${title}`;
  if (label === "MAYBE") return `[MAYBE ⚠️] ${title}`;
  return `[NOT A FIT ❌] ${title}`;
}

function formatField(title, value) {
  return { type: "mrkdwn", text: `*${title}*\n${value || "—"}` };
}

function truncate(str, maxLength) {
  if (!str) return str;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "... (truncated)";
}

export function buildSlackPayload({ opportunity, score, companyProfile }) {
  const headerText = formatFitHeader(score.fit_label, opportunity.title || "Untitled");
  
  const fields = [
    formatField("Agency", opportunity.agencyPath),
    formatField("Solicitation #", opportunity.solicitationNumber),
    formatField("Due Date", score.key_dates?.due_date || opportunity.responseDeadline),
    formatField("NAICS", opportunity.naicsCode),
    formatField("Set-aside", opportunity.setAside || opportunity.setAsideCode),
    formatField("Place", opportunity.placeOfPerformance),
  ];

  const links = [];
  const searchToken = opportunity.solicitationNumber || opportunity.noticeId;
  if (searchToken) {
    const searchUrl = `https://sam.gov/opp?keywords=${encodeURIComponent(searchToken)}`;
    links.push(`<${searchUrl}|Search on SAM.gov>`);
  }
  if (Array.isArray(opportunity.links)) {
    for (const link of opportunity.links.slice(0, 2)) {
      if (link?.href) links.push(`<${link.href}|API link>`);
      if (typeof link === "string") links.push(`<${link}|API link>`);
    }
  }
  if (opportunity.uiLink) links.push(`<${opportunity.uiLink}|SAM.gov UI>`);
  if (opportunity.additionalInfoLink) links.push(`<${opportunity.additionalInfoLink}|Additional info>`);
  if (Array.isArray(opportunity.resourceLinks)) {
    for (const link of opportunity.resourceLinks.slice(0, 3)) {
      if (typeof link === "string") links.push(`<${link}|Attachment>`);
      if (link?.url) links.push(`<${link.url}|Attachment>`);
    }
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: truncate(score.plain_english_summary, 2500) || "No summary available." } },
    { type: "divider" },
    { type: "section", fields },
  ];

  if (score.attachment_summary) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Attachment Summary:*
${truncate(score.attachment_summary, 2000)}` } });
  }

  if (score.required_skillsets && score.required_skillsets.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Required Skillsets:*
>${score.required_skillsets.join(", ")}` } });
  }

  if (score.reasons && score.reasons.length > 0) {
    const reasonsText = `*Top Reasons:*
• ${score.reasons.join("\n• ")}`;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(reasonsText, 2500) } });
  }
  
  if (score.risks && score.risks.length > 0) {
    const risksText = `*Key Risks:*
• ${score.risks.join("\n• ")}`;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(risksText, 2500) } });
  }

  if (score.must_check_items && score.must_check_items.length > 0) {
    const mustCheckText = `*Must Check Items:*
• ${score.must_check_items.join("\n• ")}`;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(mustCheckText, 2500) } });
  }

  if (links.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Links*
${links.join("\n")}` } });
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `Scored for ${companyProfile} | Fit Score: ${Math.round(score.fit_score)}` },
    ],
  });

  return { text: headerText, blocks };
}


export async function postSlackAlert({ webhookUrl, payload, fetchImpl }) {
  console.log("--- Slack Payload ---");
  console.log(JSON.stringify(payload, null, 2));
  try {
    const resp = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new SlackApiError(`Slack webhook error`, resp.status, text);
    }
  } catch (error) {
    if (error instanceof SlackApiError) {
      throw error;
    }
    throw new SlackApiError(error.message, null, null);
  }
}

export async function postSlackMessage({ token, channel, payload, fetchImpl }) {
  console.log("--- Slack Payload ---");
  console.log(JSON.stringify(payload, null, 2));
  try {
    const resp = await fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, ...payload }),
    });
    const json = await resp.json();
    if (!json.ok) {
      throw new SlackApiError(`Slack API error: ${json.error || "unknown_error"}`, resp.status, JSON.stringify(json));
    }
  } catch (error) {
    if (error instanceof SlackApiError) {
      throw error;
    }
    throw new SlackApiError(error.message, null, null);
  }
}
