// Test PIVOT scoring with just title and basic fields (no description)
const titleAndBasics = `Payment Integrity Validation and Oversight Tool (PIVOT) Development VA-26-00015670 VETERANS AFFAIRS, DEPARTMENT OF 541512 70 Service-Disabled Veteran-Owned Small Business Set-Aside SDVOSBC`.toLowerCase();

const positiveKeywords = [
  "payment integrity",
  "fraud detection",
  "data analytics",
  "ai",
  "artificial intelligence",
  "machine learning",
  "cybersecurity",
  "database management",
  "system integration",
  "software development",
  "it infrastructure",
  "security+",
  "enterprise software",
  "cloud computing",
  "saas",
  "healthcare it",
  "claims processing",
  "risk assessment",
  "data mining",
  "business intelligence",
  "healthcare claims",
  "payment systems",
  "cms",
  "medicaid",
  "medicare",
  "oversight",
  "compliance",
  "audit"
];

console.log("Text being scored:", titleAndBasics);
console.log("\n=== MATCHES FROM TITLE + BASIC FIELDS ===");

let score = 50;
let matches = 0;

for (const keyword of positiveKeywords) {
  if (titleAndBasics.includes(keyword)) {
    score += 5;
    matches++;
    console.log(`✓ Found: "${keyword}"`);
  }
}

console.log(`\nMatches: ${matches}`);
console.log(`Score: ${score}`);
console.log(`Label: ${score >= 55 ? 'GOOD_FIT' : score >= 35 ? 'MAYBE' : 'NOT_A_FIT'}`);