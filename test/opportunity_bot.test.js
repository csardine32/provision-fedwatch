import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fetchSamOpportunities } from "../bot/sam_client.js";
import { scoreWithAi } from "../bot/ai.js";
import { buildSlackPayload } from "../bot/slack.js";
import { runOpportunityBot } from "../bot/runner.js";
import { initStorage, listOpportunities } from "../bot/storage.js";

function buildMockFetch(routes) {
  return async (url, options = {}) => {
    for (const route of routes) {
      if (route.match(url, options)) {
        return route.handle(url, options);
      }
    }
    throw new Error(`No mock route for ${url}`);
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

test("SAM client paginates until totalRecords", async () => {
  const fetchImpl = buildMockFetch([
    {
      match: (url) => url.includes("opportunities/v2/search") && url.includes("offset=0"),
      handle: () =>
        jsonResponse({
          totalRecords: 3,
          opportunitiesData: [{ noticeId: "1" }, { noticeId: "2" }],
        }),
    },
    {
      match: (url) => url.includes("opportunities/v2/search") && url.includes("offset=2"),
      handle: () =>
        jsonResponse({
          totalRecords: 3,
          opportunitiesData: [{ noticeId: "3" }],
        }),
    },
  ]);

  const { opportunities } = await fetchSamOpportunities({
    apiKey: "demo",
    baseUrl: "https://api.sam.gov/opportunities/v2/search",
    postedFrom: "01/01/2024",
    postedTo: "01/02/2024",
    limit: 2,
    filters: {},
    fetchImpl,
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.equal(opportunities.length, 3);
});

test("SAM client honors max_pages_per_run", async () => {
  const seen = [];
  const fetchImpl = buildMockFetch([
    {
      match: (url) => url.includes("offset=0"),
      handle: (url) => {
        seen.push(url);
        return jsonResponse({
          totalRecords: 4,
          opportunitiesData: [{ noticeId: "1" }, { noticeId: "2" }],
        });
      },
    },
    {
      match: (url) => url.includes("offset=2"),
      handle: (url) => {
        seen.push(url);
        return jsonResponse({
          totalRecords: 4,
          opportunitiesData: [{ noticeId: "3" }, { noticeId: "4" }],
        });
      },
    },
  ]);

  let warned = false;
  const { opportunities } = await fetchSamOpportunities({
    apiKey: "demo",
    baseUrl: "https://api.sam.gov",
    postedFrom: "01/01/2024",
    postedTo: "01/02/2024",
    limit: 2,
    filters: {},
    maxPages: 1,
    fetchImpl,
    logger: {
      warn: (msg) => {
        if (msg.includes("max_pages_per_run")) warned = true;
      },
      debug: () => {},
      info: () => {},
    },
  });

  assert.equal(opportunities.length, 2);
  assert.equal(seen.length, 1);
  assert.equal(warned, true);
});

test("SAM client fixture mode returns data without fetch", async () => {
  const fixturePath = path.resolve("test/fixtures/sam_fixture.json");
  const fixture = { opportunities: [{ noticeId: "F1" }, { noticeId: "F2" }] };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  process.env.SAM_FIXTURE_PATH = fixturePath;

  const fetchImpl = () => {
    throw new Error("fetchImpl should not be called");
  };

  const { opportunities } = await fetchSamOpportunities({
    apiKey: "demo",
    baseUrl: "https://api.sam.gov",
    postedFrom: "01/01/2024",
    postedTo: "01/02/2024",
    limit: 2,
    filters: {},
    fetchImpl,
    logger: { warn: () => {}, debug: () => {}, info: () => {} },
  });

  assert.equal(opportunities.length, 2);
  delete process.env.SAM_FIXTURE_PATH;
  fs.rmSync(fixturePath);
});

test("AI scorer returns null on invalid JSON", async () => {
  const fetchImpl = buildMockFetch([
    {
      match: (url) => url.includes("openai.com/v1/chat/completions"),
      handle: () =>
        jsonResponse({
          choices: [{ message: { content: "not json" } }],
        }),
    },
  ]);

  const result = await scoreWithAi({
    apiKey: "test",
    model: "gpt-test",
    opportunity: { noticeId: "1", title: "Test" },
    descriptionText: "",
    timeoutMs: 1000,
    fetchImpl,
    logger: { warn: () => {} },
  });

  assert.equal(result, null);
});

test("Slack payload includes key blocks", () => {
  const payload = buildSlackPayload({
    opportunity: { title: "Test Opp", agencyPath: "Agency", solicitationNumber: "ABC123" },
    score: {
      fit_label: "GOOD_FIT",
      fit_score: 90,
      confidence: 0.8,
      reasons: ["Good tech fit"],
      risks: ["Short deadline"],
    },
  });
  assert.equal(payload.blocks[0].type, "header");
  assert.ok(payload.text.includes("GOOD FIT"));
});

test("Pipeline dry-run stores opportunities and scores", async () => {
  const fixtureConfig = path.resolve("test/fixtures/opportunity-bot.json");
  const dbPath = path.resolve(".data/test-opportunity-bot.sqlite");
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);

  process.env.SAM_API_KEY = "sam-key";
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/services/x";
  process.env.OPENAI_API_KEY = "openai-key";

  const fetchImpl = buildMockFetch([
    {
      match: (url) => url.includes("opportunities/v2/search"),
      handle: () =>
        jsonResponse({
          totalRecords: 1,
          opportunitiesData: [
            {
              noticeId: "N1",
              title: "Automation for Data Pipelines",
              solicitationNumber: "SOL-001",
              postedDate: "2024-01-01",
              responseDeadLine: "2024-02-01",
              naicsCode: "541512",
              typeOfSetAside: "SDVOSBC",
              description: "https://api.sam.gov/opportunities/v2/desc/N1",
            },
          ],
        }),
    },
    {
      match: (url) => url.includes("/desc/N1"),
      handle: () => textResponse("This is an AI-enabled automation project."),
    },
    {
      match: (url) => url.includes("openai.com/v1/chat/completions"),
      handle: () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  fit_label: "GOOD_FIT",
                  fit_score: 92,
                  confidence: 0.78,
                  reasons: ["Automation and data pipeline focus"],
                  risks: ["Limited detail"],
                  recommended_next_steps: ["Review details"],
                  suggested_teaming_angle: null,
                  tags: ["automation", "data"],
                  must_check_items: ["Deadline"],
                }),
              },
            },
          ],
        }),
    },
  ]);

  const summaries = await runOpportunityBot({
    dryRun: true,
    configPath: fixtureConfig,
    fetchImpl,
    now: new Date("2024-02-01T00:00:00Z"),
  });

  assert.equal(summaries[0].total, 1);
  const db = await initStorage(dbPath);
  const rows = await listOpportunities(db);
  assert.equal(rows.length, 1);
});

test("Description fetch cap limits calls per run", async () => {
  const fixtureConfig = path.resolve("test/fixtures/opportunity-bot-cap.json");
  const dbPath = path.resolve(".data/test-opportunity-bot-cap.sqlite");
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);

  process.env.SAM_API_KEY = "sam-key";

  let descriptionCalls = 0;
  const fetchImpl = buildMockFetch([
    {
      match: (url) => url.includes("opportunities/v2/search"),
      handle: () =>
        jsonResponse({
          totalRecords: 3,
          opportunitiesData: [
            { noticeId: "C1", title: "One", description: "https://desc/1" },
            { noticeId: "C2", title: "Two", description: "https://desc/2" },
            { noticeId: "C3", title: "Three", description: "https://desc/3" },
          ],
        }),
    },
    {
      match: (url) => url.startsWith("https://desc/"),
      handle: () => {
        descriptionCalls += 1;
        return textResponse("desc");
      },
    },
  ]);

  const summaries = await runOpportunityBot({
    dryRun: true,
    configPath: fixtureConfig,
    fetchImpl,
    now: new Date("2024-02-01T00:00:00Z"),
  });

  assert.equal(summaries[0].total, 3);
  assert.equal(descriptionCalls, 1);
});

test("SAM client stops early on quota exceeded 429", async () => {
  const fetchImpl = buildMockFetch([
    {
      match: (url) => url.includes("opportunities/v2/search"),
      handle: () =>
        ({
          ok: false,
          status: 429,
          clone: function clone() {
            return this;
          },
          text: async () =>
            JSON.stringify({ message: "You have exceeded your quota.", nextAccessTime: "2025-12-20" }),
          json: async () => ({
            message: "You have exceeded your quota.",
            nextAccessTime: "2025-12-20",
          }),
        }),
    },
  ]);

  let warned = false;
  const { opportunities } = await fetchSamOpportunities({
    apiKey: "demo",
    baseUrl: "https://api.sam.gov",
    postedFrom: "01/01/2024",
    postedTo: "01/02/2024",
    limit: 2,
    filters: {},
    fetchImpl,
    maxPages: null,
    logger: {
      warn: (msg) => {
        if (msg.includes("Quota exceeded")) warned = true;
      },
      debug: () => {},
      info: () => {},
    },
  });

  assert.equal(opportunities.length, 0);
  assert.equal(warned, true);
});
