-- ═══════════════════════════════════════════════════════════
--  005_pantry_soft_delete.sql
--  Adds soft-delete support to pantry_items.
--
--  Instead of repurposing used=true (which conflates "used up"
--  with "deleted by the user"), we track deletion with a
--  dedicated deleted_at timestamp.
--
--  fetchPantry() filters .is('deleted_at', null) so deleted
--  items are invisible to the app. The partial index keeps
--  the active-items scan fast.
--
--  No additional GRANTs needed — pantry_items already has full
--  DML grants for authenticated/anon from schema.sql.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pantry_items_active_idx
  ON pantry_items (deleted_at)
  WHERE deleted_at IS NULL;
