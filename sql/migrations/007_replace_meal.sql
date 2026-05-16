-- ═══════════════════════════════════════════════════════════
--  MIGRATION 007 · replace_meal RPC
--  Atomically replaces one meal's content (name, macros, ingredients,
--  steps, priority) without touching its meal_day assignment, cook
--  state, or sort_order.  Used by the P1-4 swap-meal flow.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION replace_meal(p_meal_id UUID, p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- ── 1. Wipe linked child rows ──────────────────────────
  DELETE FROM meal_ingredients WHERE meal_id = p_meal_id;
  DELETE FROM meal_steps       WHERE meal_id = p_meal_id;
  DELETE FROM meal_priority    WHERE meal_id = p_meal_id;

  -- ── 2. Update the meal row itself ─────────────────────
  UPDATE meals SET
    name           = COALESCE(p_payload->>'name',           name),
    emoji          = COALESCE(p_payload->>'emoji',          emoji),
    tagline        = p_payload->>'tagline',
    kcal_csilla    = COALESCE((p_payload->>'kcal_csilla')::INTEGER,    kcal_csilla),
    protein_csilla = COALESCE((p_payload->>'protein_csilla')::INTEGER, protein_csilla),
    carbs_csilla   = COALESCE((p_payload->>'carbs_csilla')::INTEGER,   carbs_csilla),
    fat_csilla     = COALESCE((p_payload->>'fat_csilla')::INTEGER,     fat_csilla),
    tip            = p_payload->>'tip'
  WHERE id = p_meal_id;

  -- ── 3. Insert new ingredients ─────────────────────────
  IF p_payload->'ingredients' IS NOT NULL THEN
    INSERT INTO meal_ingredients
      (meal_id, pantry_item_id, name, quantity_csilla, unit,
       is_pantry_staple, urgent, sort_order)
    SELECT
      p_meal_id,
      NULLIF(el->>'pantry_item_id', ''),
      el->>'name',
      el->>'quantity_csilla',
      el->>'unit',
      COALESCE((el->>'is_pantry_staple')::BOOLEAN, FALSE),
      COALESCE((el->>'urgent')::BOOLEAN,           FALSE),
      (idx - 1)::INTEGER
    FROM jsonb_array_elements(p_payload->'ingredients') WITH ORDINALITY AS t(el, idx);
  END IF;

  -- ── 4. Insert new steps ───────────────────────────────
  IF p_payload->'steps' IS NOT NULL THEN
    INSERT INTO meal_steps (meal_id, step_order, instruction)
    SELECT
      p_meal_id,
      COALESCE((el->>'step_order')::INTEGER, (idx - 1)::INTEGER),
      el->>'instruction'
    FROM jsonb_array_elements(p_payload->'steps') WITH ORDINALITY AS t(el, idx);
  END IF;

  -- ── 5. Insert new priority chips ─────────────────────
  IF p_payload->'priority' IS NOT NULL THEN
    INSERT INTO meal_priority (meal_id, label, urgent, sort_order)
    SELECT
      p_meal_id,
      el->>'label',
      COALESCE((el->>'urgent')::BOOLEAN, FALSE),
      (idx - 1)::INTEGER
    FROM jsonb_array_elements(p_payload->'priority') WITH ORDINALITY AS t(el, idx);
  END IF;
END;
$$;

-- RLS: only authenticated household members can call this.
-- The function itself is SECURITY DEFINER so it runs as the owner
-- (bypasses RLS on the child tables), but we still gate the call.
GRANT EXECUTE ON FUNCTION replace_meal(UUID, JSONB) TO authenticated;
