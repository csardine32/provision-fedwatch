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

  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Basic alert for opportunity: *${opportunity.title || "Untitled"}*`,
      },
    },
  ];

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
