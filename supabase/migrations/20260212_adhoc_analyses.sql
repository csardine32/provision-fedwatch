-- Ad-hoc document analyses table
-- Persists every analysis from the Analyze view, with optional matching
-- to scanner_opportunities by solicitation number.

CREATE TABLE IF NOT EXISTS adhoc_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  title TEXT,
  solicitation_number TEXT,
  matched_notice_id TEXT REFERENCES scanner_opportunities(notice_id),
  status TEXT NOT NULL DEFAULT 'active',
  project_id UUID REFERENCES projects(id),
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_adhoc_analyses_user_id ON adhoc_analyses(user_id);
CREATE INDEX idx_adhoc_analyses_status ON adhoc_analyses(status);
CREATE INDEX idx_adhoc_analyses_matched_notice_id ON adhoc_analyses(matched_notice_id);

-- RLS: user-scoped read/write, service_role has full access
ALTER TABLE adhoc_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own adhoc analyses"
  ON adhoc_analyses
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own adhoc analyses"
  ON adhoc_analyses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own adhoc analyses"
  ON adhoc_analyses
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE adhoc_analyses;
