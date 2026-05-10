-- Migration 001: Rename columns to canonical _csilla convention
-- Fixes the JS ↔ DB drift identified in P0-1.
-- All JS files already use the new names; this brings the DB into sync.

-- meals: type → meal_type (avoids SQL reserved word),
--        macro columns → *_csilla (Csilla's serving; Ralph's are computed client-side)
ALTER TABLE meals RENAME COLUMN type    TO meal_type;
ALTER TABLE meals RENAME COLUMN kcal    TO kcal_csilla;
ALTER TABLE meals RENAME COLUMN protein TO protein_csilla;
ALTER TABLE meals RENAME COLUMN carbs   TO carbs_csilla;
ALTER TABLE meals RENAME COLUMN fat     TO fat_csilla;

-- meal_days: day → day_label (avoids collision with SQL reserved word)
ALTER TABLE meal_days RENAME COLUMN day TO day_label;

-- meal_ingredients: amount → quantity_csilla, add unit column
ALTER TABLE meal_ingredients RENAME COLUMN amount TO quantity_csilla;
ALTER TABLE meal_ingredients ADD COLUMN IF NOT EXISTS unit TEXT;

-- meal_plans: add week_focus for the plan-header theme line
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS week_focus TEXT;
