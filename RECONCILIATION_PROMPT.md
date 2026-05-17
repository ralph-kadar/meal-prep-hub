# Ingredient Reconciliation Prompt (P0-8 one-shot)

Paste the block below verbatim into Cowork-Opus after deploying P0-8
phases A–C. Run it **once** against the active plan. When Opus confirms
the summary looks right, the reconciliation is done.

---

You're doing a one-shot ingredient reconciliation on Ralph & Csilla's
ACTIVE meal plan. The portion model just changed from "Csilla's serving ×
multiplier" to "batch total × portion split." Macros were auto-migrated,
but ingredient amounts need your judgement.

Project: uonfyoyzdmzuqremlqgs. Use the Supabase MCP.

**Step 1.** Read all meal_ingredients rows in the active plan:

```sql
SELECT mi.id,
       mi.name,
       mi.quantity_total,
       mi.unit,
       mi.is_pantry_staple,
       m.name  AS meal_name,
       md.day_label
FROM   meal_ingredients mi
JOIN   meals      m  ON m.id  = mi.meal_id
JOIN   meal_days  md ON md.id = m.meal_day_id
JOIN   meal_plans mp ON mp.id = md.meal_plan_id
WHERE  mp.is_active = TRUE
ORDER  BY md.sort_order, m.sort_order, mi.sort_order;
```

**Step 2.** For each row, classify `quantity_total` as one of:

**`batch`** — already represents the whole pan. No change needed.
Markers — any one is enough:
- Count of 1 of a non-divisible whole item: "1 lemon", "1 onion", "1 clove" of garlic
- Small fractional kitchen measure: "1 tbsp", "1 tsp", "1/2 tsp", "pinch", "to taste", "drizzle", "splash"
- Explicit batch language already in the amount: "whole tray", "1 bag total", "all remaining"
- Count ≤ 4 of cloves / pieces / sprigs
- `is_pantry_staple = TRUE` (salt, oil, spices)
- unit = clove, piece, sprig, leaf, pinch

**`per_person`** — was Csilla's portion; needs ×2.5 to recover the batch.
Markers — any one is enough:
- Weight in g or ml ≥ 30 of a divisible food (e.g. 175g chicken, 60g oats, 200g yogurt)
- Count ≥ 2 of a divisible serving-sized item (e.g. "2 eggs", "3 figs")
- Staple grain or protein with explicit measure (rice, bulgur, oats, quinoa, chicken, fish, meat)

**`unsure`** — skip and flag. No automatic change.

**Step 3.** Apply corrections via Supabase MCP. For each `per_person`
row, UPDATE `quantity_total = quantity_total × 2.5` (round to nearest
whole when unit is g or ml; leave as-is for count units).

```sql
-- Example:
UPDATE meal_ingredients
SET    quantity_total = ROUND(quantity_total::numeric * 2.5)::TEXT
WHERE  id = '<uuid>';
```

**Step 4.** Reply in chat with:

```
📊 Reconciliation summary
Active plan: <plan name>
Total ingredients reviewed: <n>

  batch (no change):    <n>
  per_person (×2.5):    <n>
  unsure (flagged):     <n>

Largest absolute changes (sanity-check):
  1. <meal>: <ingredient> 175g → 438g
  2. <meal>: <ingredient> 60g  → 150g
  3. <meal>: <ingredient> 200g → 500g

Rows flagged as unsure (please review manually):
  - <meal>: <ingredient> <amount> — <one-line reason>
  - …
```

Wait for Ralph's confirmation that the changes look right before moving
on. If anything looks wrong (e.g. you reclassified what should be batch
as per_person), revert with the inverse update:

```sql
UPDATE meal_ingredients
SET    quantity_total = ROUND(quantity_total::numeric / 2.5)::TEXT
WHERE  id = '<uuid>';
```
