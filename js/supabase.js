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
    .is('deleted_at', null)
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

export async function insertPantryItem(item) {
  const { data, error } = await db
    .from('pantry_items')
    .insert(item)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePantryItem(id) {
  const { error } = await db
    .from('pantry_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Shopping predictions ─────────────────────────────────

// Fetch all active, un-bought predictions (used by the Shop tab).
export async function fetchActivePredictions() {
  const { data, error } = await db
    .from('shopping_predictions')
    .select('*')
    .eq('is_active', true)
    .is('bought_at', null)
    .order('buy_by_saturday', { ascending: true });
  if (error) throw error;
  return data;
}

// Insert a single prediction row (e.g. essentials watch "Add to Saturday").
export async function insertPrediction(row) {
  const { data, error } = await db
    .from('shopping_predictions')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Mark a prediction as bought (set bought_at to now).
export async function markPredictionBought(id) {
  const { error } = await db
    .from('shopping_predictions')
    .update({ bought_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Last ~40 cooked meals for Opus context.
// NOTE: falls back to meals.cooked_date because meal_cook_log may not have
// enough rows yet in early weeks. Flag: switch to cook_log join when data matures.
export async function fetchRecentCookedMeals(limit = 40) {
  const { data, error } = await db
    .from('meals')
    .select('id, name, meal_type, cooked_date, meal_day_id')
    .eq('cooked', true)
    .not('cooked_date', 'is', null)
    .order('cooked_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
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

// ─── Past meal plans ──────────────────────────────────────

// List all inactive plans with nested day/meal data for stats in the history overlay.
export async function fetchPastPlans() {
  const { data, error } = await db
    .from('meal_plans')
    .select(`
      id, week_label, week_focus, generated_at, created_at,
      meal_days(id, meals(cooked))
    `)
    .eq('is_active', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Fetch any plan by ID (active or not) with full nested data — same shape as fetchActivePlan().
export async function fetchPlanById(planId) {
  const { data: plan, error: planErr } = await db
    .from('meal_plans')
    .select('*')
    .eq('id', planId)
    .single();
  if (planErr) throw planErr;

  const { data: days, error: daysErr } = await db
    .from('meal_days')
    .select('*')
    .eq('meal_plan_id', plan.id)
    .order('sort_order');
  if (daysErr) throw daysErr;

  const dayIds = days.map(d => d.id);
  if (!dayIds.length) return { plan, days: [] };

  const [mealsRes, priorityRes, ingredientsRes, stepsRes] = await Promise.all([
    db.from('meals').select('*').in('meal_day_id', dayIds).order('sort_order'),
    db.from('meal_priority').select('*').order('sort_order'),
    db.from('meal_ingredients').select('*').order('sort_order'),
    db.from('meal_steps').select('*').order('step_order'),
  ]);

  for (const r of [mealsRes, priorityRes, ingredientsRes, stepsRes]) {
    if (r.error) throw r.error;
  }

  for (const meal of mealsRes.data) {
    meal.priority    = priorityRes.data.filter(p => p.meal_id === meal.id);
    meal.ingredients = ingredientsRes.data.filter(i => i.meal_id === meal.id);
    meal.steps       = stepsRes.data.filter(s => s.meal_id === meal.id);
  }

  for (const day of days) {
    day.meals = mealsRes.data.filter(m => m.meal_day_id === day.id);
  }

  return { plan, days };
}

// ─── Mark meal cooked + apply pantry deductions (atomic) ──
// deductions: [{pantry_item_id, prev_used, prev_partial, applied_pct}]
// applied_pct: -1=skip, 0=all gone, 25|50|75=% remaining
export async function markMealCookedWithDeductions(mealId, deductions) {
  const { error } = await db.rpc('mark_meal_cooked', {
    p_meal_id:    mealId,
    p_deductions: deductions,
  });
  if (error) throw error;
}

// ─── Undo cook: restore pantry from log, unmark meal ──────
export async function unmarkMealCooked(mealId) {
  const { error } = await db.rpc('unmark_meal_cooked', {
    p_meal_id: mealId,
  });
  if (error) throw error;
}

// ─── Fetch cook log rows for a set of meal IDs ────────────
export async function fetchCookLog(mealIds) {
  if (!mealIds.length) return [];
  const { data, error } = await db
    .from('meal_cook_log')
    .select('meal_id, deductions')
    .in('meal_id', mealIds);
  if (error) throw error;
  return data;
}
