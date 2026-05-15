-- ═══════════════════════════════════════════════════════════
--  006_shopping_predictions.sql
--  Adds the shopping_predictions table for the P1-3 Shop tab.
--
--  Three sources feed this table:
--   'predicted'   – Opus writes rows via Supabase MCP
--   'gap_fill'    – NOT written here; computed at render time
--                   from active plan + pantry (no persistence)
--
--  The partial index keeps active-prediction lookups fast.
--  No additional GRANTs needed for auth.users; explicit DML
--  grants below follow the CHECKLIST.md pattern from 004.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE shopping_predictions (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT    NOT NULL,
  qty             TEXT,                    -- e.g. "500g", "1 bunch", "2 cans"
  category        TEXT,                    -- matches pantry_items.category values
  buy_by_saturday DATE    NOT NULL,        -- which Saturday to shop on
  reason          TEXT,                    -- ≤ 12-word "why now" from Opus
  source          TEXT    NOT NULL,        -- 'predicted' (gap_fill is never persisted)
  is_active       BOOLEAN DEFAULT TRUE,
  bought_at       TIMESTAMPTZ,             -- set when marked bought → flows to pantry
  generated_at    TIMESTAMPTZ DEFAULT NOW(),
  generated_by    TEXT                     -- 'claude-opus-4-6' | 'essentials_watch'
);


-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE shopping_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household_only" ON shopping_predictions
  FOR ALL TO authenticated
  USING  (is_household_member())
  WITH CHECK (is_household_member());


-- ── DML grants (never skip — lesson from 003/004) ─────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE shopping_predictions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE shopping_predictions TO anon;


-- ── Active-predictions index ──────────────────────────────
CREATE INDEX shopping_active_idx ON shopping_predictions (buy_by_saturday)
  WHERE is_active = TRUE AND bought_at IS NULL;
