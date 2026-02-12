-- Scanner Opportunities table
-- Holds top 25 scored opportunities synced from the FedWatch bot's local SQLite DB.
-- Read by the dashboard widget; written by the sync-top CLI command (service role).

CREATE TABLE IF NOT EXISTS scanner_opportunities (
  notice_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agency TEXT,
  solicitation_number TEXT,
  last_score REAL,
  last_fit_label TEXT,
  response_deadline TIMESTAMPTZ,
  set_aside TEXT,
  naics_code TEXT,
  ui_link TEXT,
  ai_summary TEXT,
  pursuit_status TEXT DEFAULT 'discovered',
  synced_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: authenticated users can read, service role writes
ALTER TABLE scanner_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read scanner_opportunities"
  ON scanner_opportunities
  FOR SELECT
  TO authenticated
  USING (true);

-- Add notice_id column to projects if not present (for linking tracked opportunities)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'notice_id'
  ) THEN
    ALTER TABLE projects ADD COLUMN notice_id TEXT;
    CREATE INDEX idx_projects_notice_id ON projects(notice_id);
  END IF;
END $$;
