// Quick test to debug PIVOT scoring
const text = `The Department of Veterans Affairs (VA) Office of Information Technology (OIT) requires a comprehensive Payment Integrity Validation and Oversight Tool (PIVOT) to detect, prevent, and monitor improper Community Care healthcare claims payments. The solution must provide advanced data analytics capabilities including pattern recognition, anomaly detection, machine learning algorithms, and real-time fraud detection. The system will process large volumes of healthcare claims data, identify suspicious payment patterns, and generate detailed oversight reports. Requirements include: data ingestion from multiple sources, rules engine configuration, dashboard development, API integrations, and comprehensive audit trails. The contractor must demonstrate experience in healthcare claims processing, fraud detection systems, database management, and enterprise software development. Security+ certification required for key personnel.`.toLowerCase();

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
  "audit",
  "northeast",
  "pennsylvania",
  "new jersey",
  "new york",
  "remote",
  "virtual"
];

const negativeKeywords = [
  "construction",
  "medical equipment",
  "furniture",
  "janitorial",
  "food service",
  "vehicles",
  "maintenance",
  "landscaping",
  "secret clearance",
  "top secret",
  "clearance required",
  "on-site only",
  "relocation required"
];

console.log("Text to search:", text);
console.log("\n=== POSITIVE KEYWORD MATCHES ===");

let score = 50;
let matches = 0;

for (const keyword of positiveKeywords) {
  if (text.includes(keyword)) {
    score += 5;
    matches++;
    console.log(`✓ Found: "${keyword}"`);
  }
}

console.log("\n=== NEGATIVE KEYWORD MATCHES ===");
let negativeMatches = 0;

for (const keyword of negativeKeywords) {
  if (text.includes(keyword)) {
    score -= 10;
    negativeMatches++;
    console.log(`✗ Found: "${keyword}"`);
  }
}

console.log("\n=== SCORING SUMMARY ===");
console.log(`Positive matches: ${matches}`);
console.log(`Negative matches: ${negativeMatches}`);
console.log(`Final score: ${score}`);
console.log(`Label: ${score >= 55 ? 'GOOD_FIT' : score >= 35 ? 'MAYBE' : 'NOT_A_FIT'}`);