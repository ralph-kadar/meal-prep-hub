# Chef Prompt v2 — Meal Plan Generation (P0-8+)

Use this prompt when generating a new weekly meal plan in Cowork-Opus.
It supersedes any older chef prompt. The key change is the **portion model**
section below — macros and ingredient quantities are now batch-totals,
not Csilla's-serving numbers.

---

## PORTION MODEL: one pan, one batch, two plates

- Recipes are written for **ONE batch** — the full pan, tray, or bowl as cooked.
- **Ingredient quantities are the total amount you put in the pan.** Don't scale
  per person. "350g chicken" not "175g Csilla + 175g Ralph."
- **Macros stored are the BATCH TOTAL** (sum across both plates). The app splits
  them onto Ralph's and Csilla's plates at render time using `ralph_portion`.
- **Default `ralph_portion = 0.60`** (Ralph eats 60% of the batch, Csilla 40%).
  Use this for most dinners, lunches, and shared breakfasts.
- **Set `ralph_portion = 0.50`** for meals where the split is even by nature:
  each person has their own bowl (porridge, yogurt parfait, smoothie),
  or each person gets one identical item (one apple snack, one boiled egg, one wrap).
- For rare meals where Ralph eats noticeably more or less than 60/40,
  override explicitly (e.g. `0.55` or `0.65`).

### Quick sanity check

| Meal type              | ralph_portion | Example batch qty |
|------------------------|---------------|-------------------|
| Shared dinner / lunch  | 0.60          | 350g chicken total|
| Individual bowl / snack| 0.50          | 120g oats total   |
| Very light Csilla meal | 0.65          | set explicitly    |

---

## INSERT shape for meals (relevant columns)

```sql
INSERT INTO meals (
  meal_day_id,
  meal_type,       -- breakfast | lunch | dinner | snack
  name,
  tagline,
  emoji,
  kcal_total,      -- batch total kcal (both plates combined)
  protein_total,   -- batch total protein g
  carbs_total,     -- batch total carbs g
  fat_total,       -- batch total fat g
  ralph_portion,   -- typically 0.60; use 0.50 for individual-portion meals
  serves,          -- typically 2
  tip,
  sort_order,      -- 0=breakfast, 1=lunch, 2=dinner, 3=snack
  cooked,          -- FALSE
  cooked_date      -- NULL
) VALUES (...);
```

## INSERT shape for meal_ingredients

```sql
INSERT INTO meal_ingredients (
  meal_id,
  pantry_item_id,  -- link to pantry_items.id; NULL for untracked staples
  name,
  quantity_total,  -- BATCH total quantity (not per person)
  unit,            -- g | ml | tbsp | tsp | clove | piece | bunch | …
  is_pantry_staple,-- TRUE for salt, oil, spices, etc.
  urgent,          -- TRUE if pantry item should be used this week
  sort_order
) VALUES (...);
```

---

## Goal & constraints (unchanged from v1)

Ralph & Csilla eat for **energy and longevity**:
- 30+ distinct plant species per week (vegetables, fruits, legumes, whole grains,
  herbs, seeds, nuts, mushrooms)
- Omega-3 sources 3–4× per week (oily fish, walnuts, flaxseed, chia)
- Cruciferous vegetables (broccoli, kale, cauliflower, rocket) 4–5× per week
- Legumes (lentils, chickpeas, black beans) 3–4× per week
- Minimal ultra-processed food; prefer whole ingredients
- Prioritise pantry items that expire soonest
- Avoid repeating the same protein or main vegetable more than 3× in a week

**Profiles:**
- Ralph: 30y · 180cm · 85kg · ~2,300 kcal/day · ~140g protein/day
- Csilla: 29y · 156cm · 56kg · ~1,750 kcal/day · ~95g protein/day

The app computes per-person numbers from batch totals at render time —
you only need to get the batch totals right.

---

## After generating

Write the plan to the database via Supabase MCP (project: uonfyoyzdmzuqremlqgs):
1. INSERT one `meal_plans` row with `is_active = TRUE`
   (and UPDATE any existing active plan to `is_active = FALSE` first).
2. INSERT 7 `meal_days` rows (Sunday → Saturday).
3. For each day, INSERT 4 `meals` rows (breakfast, lunch, dinner, snack).
4. For each meal, INSERT `meal_ingredients`, `meal_steps`, `meal_priority` rows.

Reply with: week focus, top 3 nutritional highlights, and any pantry items
you couldn't fit that are approaching expiry.
