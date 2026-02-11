-- Deep Dive panel columns for scanner_opportunities
-- These store AI analysis fields synced from local SQLite for inline dashboard display

ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS ai_risks_json TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS ai_skillsets_json TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS ai_key_dates_json TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS ai_must_check_json TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS ai_attachment_summary TEXT;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS ai_is_relevant BOOLEAN;
ALTER TABLE scanner_opportunities ADD COLUMN IF NOT EXISTS description_excerpt TEXT;
