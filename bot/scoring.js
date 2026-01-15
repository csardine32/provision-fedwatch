import { hashObject } from "./utils.js";

const POSITIVE_KEYWORDS = [
  "IT managed services",
  "telecommunications",
  "IT staffing",
  "IP video",
  "cable MSO",
  "IT infrastructure",
  "project delivery",
  "technology assessment",
  "network",
  "cabling",
  "staffing",
];

const NEGATIVE_KEYWORDS = [
  "construction",
  "demolition",
  "roofing",
  "asphalt",
  "paving",
  "medical supplies",
  "pharmaceutical",
  "shipbuilding",
  "vehicles",
  "furniture",
  "janitorial",
  "food service",
];

export function deterministicScore(opportunity, descriptionText = "") {
  const haystack = [
    opportunity.title,
    opportunity.solicitationNumber,
    opportunity.agencyPath,
    opportunity.naicsCode,
    opportunity.classificationCode,
    opportunity.setAside,
    opportunity.setAsideCode,
    descriptionText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 50;
  const matchedSignals = [];
  const mismatchedSignals = [];

  for (const keyword of POSITIVE_KEYWORDS) {
    if (haystack.includes(keyword)) {
      score += 5;
      matchedSignals.push(`keyword:${keyword}`);
    }
  }

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (haystack.includes(keyword)) {
      score -= 10;
      mismatchedSignals.push(`keyword:${keyword}`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    preScore: score,
    matchedSignals,
    mismatchedSignals,
  };
}

export function scoreToLabel(score, { minGood, minMaybe }) {
  if (score >= minGood) return "GOOD_FIT";
  if (score >= minMaybe) return "MAYBE";
  return "NOT_A_FIT";
}

export function buildOpportunityHash(opportunity, descriptionText) {
  return hashObject({
    noticeId: opportunity.noticeId,
    title: opportunity.title,
    solicitationNumber: opportunity.solicitationNumber,
    agencyPath: opportunity.agencyPath,
    postedDate: opportunity.postedDate,
    responseDeadline: opportunity.responseDeadline,
    naicsCode: opportunity.naicsCode,
    classificationCode: opportunity.classificationCode,
    setAsideCode: opportunity.setAsideCode,
    placeOfPerformance: opportunity.placeOfPerformance,
    descriptionText: descriptionText ? descriptionText.slice(0, 4000) : "",
  });
}

export function validateAiScore(payload) {
  if (!payload || typeof payload !== "object") return false;
  const labelOk = ["GOOD_FIT", "MAYBE", "NOT_A_FIT"].includes(payload.fit_label);
  const scoreOk = Number.isFinite(payload.fit_score);
  const confidenceOk = Number.isFinite(payload.confidence);
  const reasonsOk = Array.isArray(payload.reasons);
  const risksOk = Array.isArray(payload.risks);
  const stepsOk = Array.isArray(payload.recommended_next_steps);
  const tagsOk = Array.isArray(payload.tags);
  const mustCheckOk = Array.isArray(payload.must_check_items);
  return labelOk && scoreOk && confidenceOk && reasonsOk && risksOk && stepsOk && tagsOk && mustCheckOk;
}

export function shouldAlert({ score, config, state, hash }) {
  const alertedBefore = state?.last_alerted_hash === hash;
  if (alertedBefore) return false;

  if (score.fit_label === "GOOD_FIT" && config.alerting.post_good_fit) {
    return true;
  }
  if (score.fit_label === "MAYBE" && config.alerting.post_maybe) {
    return true;
  }
  if (score.fit_label === "NOT_A_FIT" && config.alerting.post_not_a_fit) {
    return true;
  }
  return false;
}