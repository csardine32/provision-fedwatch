-- Phase 2: Feedback, Dismissals, and new columns for scanner_opportunities
-- Run this in Supabase SQL Editor after Phase 1 migration.

-- ============================================================
-- 1. Add new columns to scanner_opportunities
-- ============================================================

ALTER TABLE scanner_opportunities
  ADD COLUMN IF NOT EXISTS ai_reasons_json TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value TEXT;

-- ============================================================
-- 2. Per-user feedback (thumbs up/down)
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  notice_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, notice_id)
);

ALTER TABLE opportunity_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own feedback"
  ON opportunity_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feedback"
  ON opportunity_feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feedback"
  ON opportunity_feedback FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own feedback"
  ON opportunity_feedback FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. Per-user dismissals
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  notice_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, notice_id)
);

ALTER TABLE opportunity_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own dismissals"
  ON opportunity_dismissals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dismissals"
  ON opportunity_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own dismissals"
  ON opportunity_dismissals FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 4. Enable realtime for new tables
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE opportunity_feedback;
ALTER PUBLICATION supabase_realtime ADD TABLE opportunity_dismissals;
