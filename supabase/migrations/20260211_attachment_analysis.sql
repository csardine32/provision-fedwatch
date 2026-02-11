-- On-demand attachment analysis columns + resource links
-- resource_links_json: SAM.gov document links synced from local SQLite data_json
-- attachment_analysis_json: structured AI analysis from Gemini (on-demand via edge function)
-- attachment_analyzed_at: timestamp of last analysis

ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS resource_links_json TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS attachment_analysis_json TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS attachment_analyzed_at TIMESTAMPTZ;
