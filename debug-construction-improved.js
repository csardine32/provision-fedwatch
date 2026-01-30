// Test construction contract with improved negative keywords
const constructionText = `Medical Center Roof Replacement and HVAC Upgrade VA-CON-2024-0778 VETERANS AFFAIRS, DEPARTMENT OF 236220 Z1BC Service-Disabled Veteran-Owned Small Business Set-Aside SDVOSBC`.toLowerCase();

const positiveKeywords = [
  "payment integrity", "fraud detection", "data analytics", "artificial intelligence",
  "machine learning", "cybersecurity", "database management", "system integration",
  "software development", "it infrastructure", "security+", "enterprise software",
  "oversight"
];

const negativeKeywords = [
  "construction", "roof replacement", "roofing", "hvac upgrade", "hvac",
  "medical equipment", "furniture", "janitorial", "food service",
  "vehicles", "maintenance", "landscaping", "plumbing", "electrical work", "building construction"
];

console.log("Construction text:", constructionText);

let score = 50;
let positiveMatches = 0;
let negativeMatches = 0;

console.log("\n=== POSITIVE MATCHES ===");
for (const keyword of positiveKeywords) {
  if (constructionText.includes(keyword)) {
    score += 5;
    positiveMatches++;
    console.log(`✓ Found: "${keyword}"`);
  }
}

console.log("\n=== NEGATIVE MATCHES ===");
for (const keyword of negativeKeywords) {
  if (constructionText.includes(keyword)) {
    score -= 10;
    negativeMatches++;
    console.log(`✗ Found: "${keyword}"`);
  }
}

console.log(`\nPositive: ${positiveMatches}, Negative: ${negativeMatches}`);
console.log(`Final score: ${score}`);
console.log(`Label: ${score >= 55 ? 'GOOD_FIT' : score >= 35 ? 'MAYBE' : 'NOT_A_FIT'}`);