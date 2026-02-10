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
  "trash removal",
  "waste removal",
  "snow removal",
  "plowing",
  "landscaping",
  "grounds maintenance",
  "custodial",
  "painting",
  "elevator",
  "hvac",
  "plumbing",
  "carpentry",
  "welding",
  "concrete",
  "structural",
  "parking attendant",
  "courier",
  "food delivery",
  "laundry",
];

/**
 * @param {object} opportunity - Normalized opportunity
 * @param {string} descriptionText
 * @param {{ positive?: string[], negative?: string[] }} [keywords] - Optional config-driven keyword lists. Falls back to hardcoded lists when not provided.
 */
export function deterministicScore(opportunity, descriptionText = "", keywords) {
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

  const positiveList = keywords?.positive ?? POSITIVE_KEYWORDS;
  const negativeList = keywords?.negative ?? NEGATIVE_KEYWORDS;

  let score = 50;
  const matchedSignals = [];
  const mismatchedSignals = [];

  for (const keyword of positiveList) {
    if (haystack.includes(keyword.toLowerCase())) {
      score += 5;
      matchedSignals.push(`keyword:${keyword}`);
    }
  }

  for (const keyword of negativeList) {
    if (haystack.includes(keyword.toLowerCase())) {
      score -= 15;
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

export function buildOpportunityHash(opportunity, descriptionText, attachmentText) {
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
    attachmentText: attachmentText ? attachmentText.slice(0, 4000) : "",
  });
}

export function validateAiScore(payload) {
  if (!payload || typeof payload !== "object") return false;

  const isRelevantOk = typeof payload.is_relevant === "boolean";
  const summaryOk = typeof payload.plain_english_summary === "string";
  const skillsetsOk = Array.isArray(payload.required_skillsets);
  const labelOk = ["GOOD_FIT", "MAYBE", "NOT_A_FIT"].includes(payload.fit_label);
  const scoreOk = Number.isFinite(payload.fit_score);
  const reasonsOk = Array.isArray(payload.reasons);
  const risksOk = Array.isArray(payload.risks);
  const keyDatesOk = typeof payload.key_dates === "object" && payload.key_dates !== null && typeof payload.key_dates.due_date === "string" && Array.isArray(payload.key_dates.other_dates);
  const attachmentSummaryOk = typeof payload.attachment_summary === "string";
  const mustCheckOk = Array.isArray(payload.must_check_items);

  return isRelevantOk && summaryOk && skillsetsOk && labelOk && scoreOk && reasonsOk && risksOk && keyDatesOk && attachmentSummaryOk && mustCheckOk;
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

export function buildFallbackScore(preScore, thresholds) {
  const fit_label = scoreToLabel(preScore, thresholds);
  return {
    is_relevant: true, // Assume relevant if we are scoring it
    plain_english_summary: "AI scoring unavailable. This is a fallback score based on keyword matching.",
    required_skillsets: [],
    fit_label,
    fit_score: preScore,
    reasons: ["AI scoring unavailable; fallback used."],
    risks: [],
    key_dates: { due_date: "", other_dates: [] },
    attachment_summary: "",
    must_check_items: [],
  };
}

/**
 * Blend deterministic and AI scores, applying eligibility penalties.
 *
 * @param {{ preScore: number, matchedSignals: string[], mismatchedSignals: string[] }} deterministicResult
 * @param {object|null} aiScore - Full AI score object, or null if AI unavailable
 * @param {{ isEligible: boolean, issues: Array<{ type: string, severity: string, message: string }> }} eligibility
 * @param {{ minGood: number, minMaybe: number }} thresholds
 * @returns {object} Final score object in the same shape as AI score
 */
export function blendScores(deterministicResult, aiScore, eligibility, thresholds) {
  const { preScore } = deterministicResult;

  // Count eligibility warnings (not disqualifying — those are handled upstream)
  const warningCount = eligibility.issues.filter((i) => i.severity === "warning").length;
  const eligibilityPenalty = warningCount * 15;

  // If AI unavailable, use fallback with eligibility penalty
  if (!aiScore) {
    const penalized = Math.max(0, preScore - eligibilityPenalty);
    const fallback = buildFallbackScore(penalized, thresholds);
    if (warningCount > 0) {
      fallback.risks = [
        ...fallback.risks,
        ...eligibility.issues.filter((i) => i.severity === "warning").map((i) => i.message),
      ];
    }
    return fallback;
  }

  // If deterministic score is very low, cap AI contribution
  let aiContribution = aiScore.fit_score;
  if (preScore < 25) {
    aiContribution = Math.min(aiContribution, 40);
  }

  // Weighted blend: 30% deterministic + 70% AI
  let blended = Math.round(preScore * 0.3 + aiContribution * 0.7);

  // Apply eligibility penalty
  blended = Math.max(0, Math.min(100, blended - eligibilityPenalty));

  // Recalculate label from blended score
  const fit_label = scoreToLabel(blended, thresholds);

  // Build merged risks with eligibility warnings
  const risks = [...(aiScore.risks || [])];
  for (const issue of eligibility.issues) {
    if (issue.severity === "warning") {
      risks.push(issue.message);
    }
  }

  return {
    ...aiScore,
    fit_score: blended,
    fit_label,
    risks,
  };
}
