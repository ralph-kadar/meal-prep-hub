// ─── Supabase Client ──────────────────────────────────────
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

const { createClient } = window.supabase;
export const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Auth helpers ─────────────────────────────────────────
export const auth = db.auth;

export async function getSession() {
  const { data: { session } } = await db.auth.getSession();
  return session;
}

export async function signInWithGitHub() {
  await db.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

export async function signOut() {
  await db.auth.signOut();
}

// ─── Pantry ───────────────────────────────────────────────
export async function fetchPantry() {
  const { data, error } = await db
    .from('pantry_items')
    .select('*')
    .order('expiry_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function updatePantryItem(id, patch) {
  const { error } = await db
    .from('pantry_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Meal Plan ────────────────────────────────────────────
export async function fetchActivePlan() {
  // Fetch the active meal plan with all its nested data in one query
  const { data: plan, error: planErr } = await db
    .from('meal_plans')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (planErr) throw planErr;

  const { data: days, error: daysErr } = await db
    .from('meal_days')
    .select('*')
    .eq('meal_plan_id', plan.id)
    .order('sort_order');
  if (daysErr) throw daysErr;

  const dayIds = days.map(d => d.id);

  const [mealsRes, priorityRes, ingredientsRes, stepsRes] = await Promise.all([
    db.from('meals').select('*').in('meal_day_id', dayIds).order('sort_order'),
    db.from('meal_priority').select('*').order('sort_order'),
    db.from('meal_ingredients').select('*').order('sort_order'),
    db.from('meal_steps').select('*').order('step_order'),
  ]);

  for (const r of [mealsRes, priorityRes, ingredientsRes, stepsRes]) {
    if (r.error) throw r.error;
  }

  // Attach meals → days, then ingredients/steps/priority → meals
  const mealMap = {};
  for (const meal of mealsRes.data) {
    meal.priority    = priorityRes.data.filter(p => p.meal_id === meal.id);
    meal.ingredients = ingredientsRes.data.filter(i => i.meal_id === meal.id);
    meal.steps       = stepsRes.data.filter(s => s.meal_id === meal.id);
    mealMap[meal.id] = meal;
  }

  for (const day of days) {
    day.meals = mealsRes.data.filter(m => m.meal_day_id === day.id);
  }

  return { plan, days };
}

// ─── Mark meal cooked / uncooked ─────────────────────────
export async function setMealCooked(mealId, cooked) {
  const { error } = await db
    .from('meals')
    .update({
      cooked,
      cooked_date: cooked ? new Date().toISOString().slice(0, 10) : null
    })
    .eq('id', mealId);
  if (error) throw error;
}
