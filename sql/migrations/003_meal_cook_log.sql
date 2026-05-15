-- ═══════════════════════════════════════════════════════════
--  003_meal_cook_log.sql
--  Adds the meal_cook_log table (stores per-ingredient deduction
--  snapshots for reversible cook/uncook) and the two helper
--  functions that perform the atomic cook + uncook operations.
-- ═══════════════════════════════════════════════════════════


-- ── TABLE ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meal_cook_log (
  meal_id    UUID PRIMARY KEY REFERENCES meals(id) ON DELETE CASCADE,
  cooked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Array of {pantry_item_id, prev_used, prev_partial, applied_pct}
  deductions JSONB NOT NULL
);

ALTER TABLE meal_cook_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household_only" ON meal_cook_log
  FOR ALL TO authenticated
  USING (is_household_member())
  WITH CHECK (is_household_member());


-- ── mark_meal_cooked ───────────────────────────────────────
-- Called when the user hits "✓ Update pantry" in the cook panel.
-- Atomically:
--   1. Applies per-ingredient deductions to pantry_items.
--   2. Marks the meal cooked.
--   3. Persists the deduction snapshot in meal_cook_log.
--
-- p_deductions: JSONB array of objects:
--   { pantry_item_id: text, prev_used: bool, prev_partial: int|null, applied_pct: int }
--   applied_pct = -1 → skip (don't touch pantry)
--   applied_pct =  0 → all gone (used = true)
--   applied_pct = 25|50|75 → partial remaining

CREATE OR REPLACE FUNCTION mark_meal_cooked(
  p_meal_id    UUID,
  p_deductions JSONB
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  d           JSONB;
  applied_pct INT;
BEGIN
  -- 1. Apply per-ingredient deductions
  FOR d IN SELECT value FROM jsonb_array_elements(p_deductions) LOOP
    applied_pct := (d->>'applied_pct')::INT;

    IF applied_pct = -1 THEN
      CONTINUE;  -- Skip — leave pantry item untouched

    ELSIF applied_pct = 0 THEN
      -- All gone → mark used, clear partial
      UPDATE pantry_items
        SET used              = TRUE,
            used_date         = CURRENT_DATE,
            partial_remaining = NULL
      WHERE id = d->>'pantry_item_id';

    ELSE
      -- Partial remaining → clear used, set partial %
      UPDATE pantry_items
        SET used              = FALSE,
            used_date         = NULL,
            partial_remaining = applied_pct
      WHERE id = d->>'pantry_item_id';
    END IF;
  END LOOP;

  -- 2. Mark meal cooked
  UPDATE meals
    SET cooked      = TRUE,
        cooked_date = CURRENT_DATE
  WHERE id = p_meal_id;

  -- 3. Persist snapshot (upsert — handles retry after network failure)
  INSERT INTO meal_cook_log (meal_id, deductions)
  VALUES (p_meal_id, p_deductions)
  ON CONFLICT (meal_id) DO UPDATE
    SET deductions = EXCLUDED.deductions,
        cooked_at  = NOW();
END;
$$;


-- ── unmark_meal_cooked ─────────────────────────────────────
-- Called when the user hits "undo" on a cooked stamp.
-- Reads the deduction snapshot and reverses each change, then
-- unmarks the meal and deletes the log row.

CREATE OR REPLACE FUNCTION unmark_meal_cooked(p_meal_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  log_row meal_cook_log%ROWTYPE;
  d       JSONB;
BEGIN
  -- 1. Load deduction log
  SELECT * INTO log_row FROM meal_cook_log WHERE meal_id = p_meal_id;

  IF FOUND THEN
    -- 2. Restore each pantry item to its pre-cook state
    FOR d IN SELECT value FROM jsonb_array_elements(log_row.deductions) LOOP
      -- Items that were skipped need no restoration
      IF (d->>'applied_pct')::INT = -1 THEN CONTINUE; END IF;

      UPDATE pantry_items
        SET used              = (d->>'prev_used')::BOOLEAN,
            used_date         = CASE
                                  WHEN (d->>'prev_used')::BOOLEAN THEN CURRENT_DATE
                                  ELSE NULL
                                END,
            partial_remaining = CASE
                                  WHEN d->>'prev_partial' IS NULL
                                    OR d->>'prev_partial' = 'null'
                                  THEN NULL
                                  ELSE (d->>'prev_partial')::INT
                                END
      WHERE id = d->>'pantry_item_id';
    END LOOP;

    -- 3. Delete the log row
    DELETE FROM meal_cook_log WHERE meal_id = p_meal_id;
  END IF;

  -- 4. Unmark the meal (always, even if no log existed)
  UPDATE meals
    SET cooked      = FALSE,
        cooked_date = NULL
  WHERE id = p_meal_id;
END;
$$;
