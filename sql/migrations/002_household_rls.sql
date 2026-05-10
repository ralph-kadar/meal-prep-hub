-- Migration 002: Lock RLS to household members only (P0-2)
-- Replaces wide-open "auth_all" policies (any GitHub user = full access)
-- with a household_members allowlist. Adding Csilla later = one INSERT.

CREATE TABLE IF NOT EXISTS household_members (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Ralph (replace UUID if the Supabase project is ever recreated)
INSERT INTO household_members (user_id, name)
VALUES ('ba49aa7e-9ae5-4f85-b4bc-6a94d14c6d5e', 'Ralph')
ON CONFLICT DO NOTHING;

-- household_members itself: only members can read their own table
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "household_read" ON household_members FOR SELECT TO authenticated
  USING (auth.uid() IN (SELECT user_id FROM household_members));

-- Reusable helper called by every table policy
CREATE OR REPLACE FUNCTION is_household_member()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM household_members WHERE user_id = auth.uid()
  );
$$;

-- Replace "auth_all" on all seven tables with "household_only"
DO $$ DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['pantry_items','meal_plans','meal_days','meals',
                              'meal_priority','meal_ingredients','meal_steps']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "household_only" ON %I FOR ALL TO authenticated
       USING (is_household_member()) WITH CHECK (is_household_member())',
      tbl
    );
  END LOOP;
END $$;

-- To add Csilla once she signs in, run:
-- INSERT INTO household_members (user_id, name) VALUES ('<csilla-uuid>', 'Csilla');
