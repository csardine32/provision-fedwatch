/**
 * Pre-AI eligibility gate checks.
 * Screens opportunities for disqualifying or warning conditions
 * before spending API calls on AI scoring.
 */

const CLEARANCE_PATTERNS = [
  /top\s+secret/i,
  /ts\/sci/i,
  /ts\/ssbi/i,
  /secret\s+clearance\s+required/i,
  /polygraph\s+required/i,
  /polygraph\s+examination/i,
  /must\s+possess\s+.*(?:top\s+secret|ts\/sci|secret\s+clearance)/i,
];

const SOLE_SOURCE_PATTERNS = [
  /sole\s+source/i,
  /notice\s+of\s+intent\b.*\bsole\s+source/i,
  /justification\s+(?:and\s+)?(?:approval|for)\s+.*sole\s+source/i,
];

/**
 * Check eligibility of an opportunity against company capabilities.
 *
 * @param {object} opportunity - Normalized opportunity object
 * @param {string} descriptionText - Full description text
 * @param {object} companyEligibility - From config: { has_8a, has_clearance, certifications }
 * @returns {{ isEligible: boolean, issues: Array<{ type: string, severity: 'disqualifying'|'warning', message: string }> }}
 */
export function checkEligibility(opportunity, descriptionText = "", companyEligibility = {}) {
  const issues = [];
  const haystack = [
    opportunity.title,
    opportunity.setAside,
    opportunity.setAsideCode,
    descriptionText,
  ]
    .filter(Boolean)
    .join(" ");

  // 8(a) set-aside mismatch
  const setAsideCode = (opportunity.setAsideCode || "").toUpperCase();
  if ((setAsideCode === "8A" || setAsideCode === "8AN") && !companyEligibility.has_8a) {
    issues.push({
      type: "8a_mismatch",
      severity: "disqualifying",
      message: `Set-aside requires 8(a) certification (code: ${setAsideCode}), which this company does not hold.`,
    });
  }

  // Clearance requirements
  if (!companyEligibility.has_clearance) {
    for (const pattern of CLEARANCE_PATTERNS) {
      if (pattern.test(haystack)) {
        issues.push({
          type: "clearance_required",
          severity: "disqualifying",
          message: `Opportunity requires security clearance (matched: ${pattern.source}). Company does not hold required clearance.`,
        });
        break; // One clearance issue is enough
      }
    }
  }

  // Sole source to another vendor
  for (const pattern of SOLE_SOURCE_PATTERNS) {
    if (pattern.test(haystack)) {
      issues.push({
        type: "sole_source",
        severity: "warning",
        message: "Opportunity appears to be a sole-source award to an incumbent or specific vendor.",
      });
      break;
    }
  }

  const isEligible = !issues.some((i) => i.severity === "disqualifying");
  return { isEligible, issues };
}
