-- ═══════════════════════════════════════════════════════════
--  004_meal_cook_log_rls.sql
--  Hotfix for P0-5: meal_cook_log was missing SELECT/INSERT/
--  UPDATE/DELETE grants for the authenticated role, causing
--  "permission denied for table meal_cook_log" on plan load.
--
--  Root cause: Supabase's ALTER DEFAULT PRIVILEGES grants are
--  owned by the supabase_admin service user, NOT postgres, so
--  tables created via the migration runner don't inherit them.
--  Every new table needs explicit GRANT statements.
--
--  Also adds GRANT EXECUTE on the two cook RPCs, which were
--  created without SECURITY DEFINER and therefore need an
--  explicit execute grant for the authenticated role.
-- ═══════════════════════════════════════════════════════════


-- ── RLS (idempotent — already done in 003, included per spec) ──

ALTER TABLE meal_cook_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household_only" ON meal_cook_log;
CREATE POLICY "household_only" ON meal_cook_log
  FOR ALL TO authenticated
  USING (is_household_member())
  WITH CHECK (is_household_member());


-- ── Table-level DML grants (the actual fix) ────────────────
-- authenticated needs SELECT/INSERT/UPDATE/DELETE.
-- anon gets the same grants — RLS blocks non-members anyway.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meal_cook_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meal_cook_log TO anon;


-- ── RPC execute grants ─────────────────────────────────────
-- Functions were created without SECURITY DEFINER, so the
-- authenticated role needs an explicit EXECUTE grant.

GRANT EXECUTE ON FUNCTION mark_meal_cooked(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION unmark_meal_cooked(uuid)      TO authenticated;
