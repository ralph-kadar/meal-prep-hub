# Migration Checklist

Every `.sql` file in this directory runs via the Supabase MCP
`apply_migration` tool, which executes as the `postgres` role.
Supabase's default-privilege grants (owned by `supabase_admin`) do **not**
auto-apply, so new tables need explicit grants.

## Required steps for every new table

```sql
-- 1. Enable RLS
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

-- 2. Create household policy
CREATE POLICY "household_only" ON <table>
  FOR ALL TO authenticated
  USING (is_household_member())
  WITH CHECK (is_household_member());

-- 3. Grant DML to app roles
--    (RLS handles who can actually read/write — grants just open the door)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE <table> TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE <table> TO anon;
```

## Required steps for every new function called from the client

```sql
-- Functions without SECURITY DEFINER need an explicit EXECUTE grant
GRANT EXECUTE ON FUNCTION <fn>(arg_types) TO authenticated;
```

## Lesson from 003/004

Migration 003 created `meal_cook_log` and added the RLS policy but forgot
the `GRANT SELECT/INSERT/UPDATE/DELETE` and `GRANT EXECUTE` on the RPCs.
This caused "permission denied for table meal_cook_log" on every plan load
until hotfixed in 004.
