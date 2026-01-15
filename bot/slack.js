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

export function buildSlackPayload({ opportunity, score }) {
  const headerText = formatFitHeader(score.fit_label, opportunity.title || "Untitled");
  const fields = [
    formatField("Agency", opportunity.agencyPath),
    formatField("Solicitation #", opportunity.solicitationNumber),
    formatField("Posted", opportunity.postedDate),
    formatField("Due", opportunity.responseDeadline),
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

  const reasons = (score.reasons || []).slice(0, 6).map((item) => `• ${item}`).join("\n");
  const risks = (score.risks || []).slice(0, 4).map((item) => `• ${item}`).join("\n");

  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText } },
    { type: "section", fields },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Fit score:* ${Math.round(score.fit_score)}  |  *Confidence:* ${Math.round(
          score.confidence * 100
        )}%`,
      },
    },
  ];

  if (reasons) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Top reasons*\n${reasons}` } });
  }
  if (risks) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Key risks*\n${risks}` } });
  }
  if (links.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Links*\n${links.join("\n")}` } });
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: "Scored for ProVision Systems / Provisions Unlimited (SDVOSB)" },
    ],
  });

  return { text: headerText, blocks };
}

export async function postSlackAlert({ webhookUrl, payload, fetchImpl }) {
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
