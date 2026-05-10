-- ═══════════════════════════════════════════════════════════
--  MEAL PREP HUB · DATABASE SCHEMA
--  Run this entire file in Supabase → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════


-- ── PANTRY ITEMS ────────────────────────────────────────────
-- One row per ingredient. Holds both catalog data (name,
-- category, expiry) and live state (used, partial_remaining).

CREATE TABLE IF NOT EXISTS pantry_items (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  name_ro             TEXT,
  category            TEXT,
  subcategory         TEXT,
  quantity            TEXT,        -- kept as text: "~1kg", "1 bunch", "638" etc.
  unit                TEXT,
  purchase_date       DATE,
  expiry_date         DATE,
  perishability_level TEXT,        -- critical | high | medium | low | stable
  storage_location    TEXT,
  notes               TEXT,
  tags                TEXT[],
  -- live state (updated by the app)
  used                BOOLEAN DEFAULT FALSE,
  used_date           DATE,
  partial_remaining   INTEGER,     -- 0–100 (% left), NULL = fully available
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-bump updated_at on every change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pantry_items_updated_at
  BEFORE UPDATE ON pantry_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── MEAL PLANS ──────────────────────────────────────────────
-- One row per generated week. is_active = TRUE marks the
-- current week shown in the app.

CREATE TABLE IF NOT EXISTS meal_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_label   TEXT,               -- e.g. "Week of May 10–16"
  generated_by TEXT,               -- "claude-opus-4-6"
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  notes        TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ── MEAL DAYS ───────────────────────────────────────────────
-- 7 rows per meal_plan (Sun → Sat).

CREATE TABLE IF NOT EXISTS meal_days (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,       -- "Sunday", "Monday" …
  date         TEXT NOT NULL,       -- "May 10"
  focus        TEXT,                -- "🥑 Avocado · Beetroot"
  urgent       BOOLEAN DEFAULT FALSE,
  sort_order   INTEGER NOT NULL     -- 0–6
);


-- ── MEALS ───────────────────────────────────────────────────
-- 4 rows per meal_day (breakfast, lunch, dinner, snack).

CREATE TABLE IF NOT EXISTS meals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_day_id UUID NOT NULL REFERENCES meal_days(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,        -- breakfast | lunch | dinner | snack
  emoji       TEXT,
  name        TEXT NOT NULL,
  tagline     TEXT,
  kcal        INTEGER,              -- Csilla's serving
  protein     INTEGER,              -- Csilla's serving
  carbs       INTEGER,              -- Csilla's serving
  fat         INTEGER,              -- Csilla's serving
  tip         TEXT,
  sort_order  INTEGER NOT NULL,     -- 0=breakfast … 3=snack
  cooked      BOOLEAN DEFAULT FALSE,
  cooked_date DATE
);


-- ── MEAL PRIORITY ───────────────────────────────────────────
-- Highlighted "use these up" ingredients shown on meal cards.

CREATE TABLE IF NOT EXISTS meal_priority (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id    UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  urgent     BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0
);


-- ── MEAL INGREDIENTS ────────────────────────────────────────
-- Each ingredient is linked to pantry_items by ID (no more
-- fuzzy name matching). pantry_item_id can be NULL for
-- staples not tracked individually (e.g. salt, pepper).

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id          UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  pantry_item_id   TEXT REFERENCES pantry_items(id),
  name             TEXT NOT NULL,
  amount           TEXT,
  is_pantry_staple BOOLEAN DEFAULT FALSE,
  urgent           BOOLEAN DEFAULT FALSE,
  sort_order       INTEGER DEFAULT 0
);


-- ── MEAL STEPS ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meal_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id     UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  step_order  INTEGER NOT NULL,
  instruction TEXT NOT NULL
);


-- ═══════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  Authenticated users (logged in via GitHub OAuth) can
--  read and write everything. Unauthenticated requests
--  are blocked entirely.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE pantry_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_days        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_priority    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_steps       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON pantry_items     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON meal_plans       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON meal_days        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON meals            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON meal_priority    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON meal_ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON meal_steps       FOR ALL TO authenticated USING (true) WITH CHECK (true);
