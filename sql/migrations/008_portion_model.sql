-- ═══════════════════════════════════════════════════════════
--  MIGRATION 008 · Portion model: batch-total + split
--
--  Replaces the "Csilla's serving × multiplier" model with a cleaner
--  "one batch, split 60/40 onto plates" model.
--
--  Before: kcal_csilla = Csilla's plate (40% of batch)
--          Ralph's plate = kcal_csilla × 1.31 multiplier
--
--  After:  kcal_total = full batch (what goes in the pan)
--          Ralph's plate  = kcal_total × ralph_portion  (default 0.60)
--          Csilla's plate = kcal_total × (1−ralph_portion) (default 0.40)
--
--  Csilla's displayed numbers stay identical (40% of back-filled total
--  = original kcal_csilla). Ralph's go up to his real 60% portion.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Add split columns to meals ────────────────────────
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS ralph_portion DECIMAL(3,2) DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS serves        INTEGER       DEFAULT 2;

-- ── 2. Rename macro columns: per-person → batch-total ────
ALTER TABLE meals
  RENAME COLUMN kcal_csilla    TO kcal_total;
ALTER TABLE meals
  RENAME COLUMN protein_csilla TO protein_total;
ALTER TABLE meals
  RENAME COLUMN carbs_csilla   TO carbs_total;
ALTER TABLE meals
  RENAME COLUMN fat_csilla     TO fat_total;

-- ── 3. Back-fill batch totals across ALL plans ────────────
-- Old kcal_csilla was Csilla's plate = 40% of the batch.
-- Divide by 0.40 to recover the full batch total.
-- (ROUND to keep INTEGER semantics.)
UPDATE meals SET
  kcal_total    = ROUND(kcal_total    / 0.40),
  protein_total = ROUND(protein_total / 0.40),
  carbs_total   = ROUND(carbs_total   / 0.40),
  fat_total     = ROUND(fat_total     / 0.40)
WHERE kcal_total IS NOT NULL;

-- ── 4. Rename ingredient amount column ───────────────────
ALTER TABLE meal_ingredients
  RENAME COLUMN quantity_csilla TO quantity_total;

-- No new tables → no RLS/GRANT boilerplate needed (existing policies
-- cover the renamed columns automatically; column renames are DDL-only
-- and don't affect RLS policies or DML grants).
