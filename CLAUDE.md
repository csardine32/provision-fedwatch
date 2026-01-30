# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Provision-FedWatch is a revolutionary Node.js system that implements a "market-domination" strategy for government contracting. Instead of focusing on traditional "IT services only," it scans opportunities across ALL industries to identify contracts where technology and automation create competitive advantages. The system uses AI to evaluate automation potential and only alerts on opportunities where tech skills provide unfair advantages over traditional competitors.

**Strategic Philosophy**: "Bring Silicon Valley tech innovation to traditional government contracting sectors"

## Market-Domination Strategy

### Core Approach
- **Cast the widest net**: Scan 100+ opportunities daily across all industries
- **AI-powered filtering**: Evaluate automation potential rather than industry classification
- **Target inefficiencies**: Find manual processes that can be automated/digitized
- **Scale advantages**: Build tech solutions that traditional competitors can't match

### Target Opportunity Types
- Hardware procurement with supply chain optimization potential
- Compliance processes that can be automated
- Vendor management requiring digital platforms
- Quality assurance with tracking/reporting automation
- Logistics coordination with scheduling optimization
- Manual paperwork processes ripe for digitization

## Common Development Commands

### Bot Operations
```bash
# Development and testing
npm run bot:dry-run                              # Safe test run without Slack posting
npm run bot:run                                  # Live execution with garbage collection
npm run bot:backfill                             # Backfill 7 days of historical data

# CLI variants with options
node bot/cli.js run --dry-run --verbose          # Verbose dry run for debugging
node bot/cli.js run --profiles "Tech-Enhanced Market Opportunities"  # Run specific profile
node bot/cli.js backfill --days N                # Backfill N days of history
node bot/cli.js run --config <path>              # Use custom config file
```

### Testing
```bash
npm test                                         # Run Node.js built-in test suite
SAM_FIXTURE_PATH=test/fixtures/sam.json npm run bot:dry-run  # Test with fixtures (no API calls)
./scripts/smoke_scorer.sh                        # Quick validation test
```

### System Requirements
- **Node.js**: v18+ required (uses ES modules)
- **External Tools**:
  - `poppler` for PDF extraction (`brew install poppler` on macOS)
  - `docx2txt` for DOCX extraction (`brew install docx2txt` on macOS)

## Architecture Overview

### Core Data Flow
```
CLI Entry → Load Config → Market-Wide Scan:
  SAM.gov API (All Industries) → Normalize → Store → Enrich → AI Evaluation → Automation Scoring → Slack Alerts
```

### Key Components
- **`bot/cli.js`**: Command-line entry point with argument parsing
- **`bot/runner.js`**: Main orchestration logic for cross-industry scanning
- **`bot/sam_client.js`**: SAM.gov API client with high-volume capability
- **`bot/storage.js`**: SQLite wrapper for opportunity tracking and deduplication
- **`bot/scoring.js`**: Hybrid scoring system focused on automation potential
- **`bot/ai.js`**: Google Gemini integration for automation assessment
- **`bot/slack.js`**: Rich Slack alerts with AI analysis and automation insights
- **`bot/enrich.js`**: Document processing for comprehensive opportunity analysis

### Market-Domination Configuration
Single profile in `config/opportunity-bot.json` configured for maximum coverage:

**Scanning Strategy**:
- **No NAICS filtering**: Scan across all industries and sectors
- **Set-aside focused**: SDVOSB + Small Business + 8(a) opportunities
- **Dollar range**: $25K-$5M (sweet spot for tech advantages)
- **High volume**: 50 opportunities per run, 2 pages, 10 descriptions

**AI-Enhanced Scoring**:
- **Automation Keywords**: Focus on "manual processes," "spreadsheets," "coordination," "tracking," "compliance"
- **Tech Advantage Signals**: "efficiency," "streamline," "modernization," "digitization"
- **Competitive Moats**: Identify where tech creates unfair advantages

## Scoring System Revolution

### AI-First Automation Assessment
1. **Automation Potential**: AI evaluates opportunities for process improvement potential
2. **Tech Advantage**: Identifies where IT skills create competitive moats
3. **Market Sophistication**: Assesses competitor technical maturity
4. **Scalability**: Evaluates potential for building reusable tech solutions

### Scoring Criteria (0-100 scale)
- **50+ (GOOD_FIT)**: High automation potential, clear tech advantages
- **30-49 (MAYBE)**: Moderate automation opportunities worth reviewing
- **<30 (NOT_A_FIT)**: Limited tech advantage over traditional competitors

### AI Analysis Output
Rich structured analysis including:
- **Automation opportunities**: Specific processes that can be improved
- **Required skillsets**: Technical capabilities needed
- **Competitive advantages**: How tech creates differentiation
- **Implementation approach**: Recommended automation strategy
- **Risk assessment**: Potential challenges and mitigation

## Environment Variables
Required runtime environment variables:
```bash
SAM_API_KEY                    # SAM.gov API key (high quota recommended)
GEMINI_API_KEY                 # Google Generative AI key (required for automation analysis)
SLACK_BOT_TOKEN                # Slack bot token for alerts
SLACK_BOT_TOKEN_PROVISIONS     # Alternative workspace token
SLACK_BOT_TOKEN_STATUS         # Status notification token
```

## Cost Optimization Results
**Massive cost reduction achieved**:
- **Before**: $250/month (excessive AI usage, narrow focus)
- **After**: ~$25/month (smart filtering, targeted AI analysis)
- **90% cost savings** while expanding coverage 20x

**Efficiency improvements**:
- Pre-filter with deterministic scoring before AI analysis
- Smart batching and API quota management
- Reduced attachment processing for non-relevant opportunities

## Database Schema
SQLite database auto-created at `./.data/opportunity_bot.sqlite`:
- **opportunities**: Cross-industry opportunity data with automation scoring
- **alerts**: Deduplication and alert history tracking
- **Market intelligence**: Historical data for pattern recognition

## Testing Strategy
- **Unit Tests**: Node.js built-in `node:test` framework in `test/opportunity_bot.test.js`
- **Cross-Industry Fixtures**: Realistic test data spanning multiple sectors
- **AI Scoring Validation**: Test automation potential assessment
- **Market Coverage Tests**: Verify wide-net scanning approach

## Slack Integration
AI-enhanced Block Kit alerts with:
- **Automation Analysis**: Detailed AI assessment of tech opportunities
- **Process Improvement**: Specific automation recommendations
- **Competitive Advantage**: How tech creates unfair advantages
- **Implementation Roadmap**: Suggested approach for leveraging tech
- **Market Context**: Industry sophistication and opportunity landscape

## Deployment Strategy
- **GitHub Actions**: Automated twice-daily market scans
- **Production Monitoring**: Cross-industry opportunity flow tracking
- **Alert Quality**: AI ensures only high-automation-potential opportunities surface
- **Market Intelligence**: Continuous learning about automation opportunities across sectors

## Success Metrics
- **Opportunity Discovery**: 100+ opportunities scanned daily vs 3-5 previously
- **Quality Filtering**: AI prevents false positives from misleading NAICS codes
- **Cost Efficiency**: 90% cost reduction while expanding market coverage
- **Strategic Positioning**: Technology advantages in traditional contracting sectors
- **Revenue Diversification**: Multiple industry streams vs single-sector dependency

This system transforms government contracting from "finding IT work" to "using IT to dominate any market" - positioning for sustainable competitive advantages across the entire federal marketplace.