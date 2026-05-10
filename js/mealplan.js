// ─── Meal Plan Module ─────────────────────────────────────
import { fetchActivePlan, setMealCooked } from './supabase.js';
import { RALPH_MULTIPLIERS } from './config.js';

let _plan = null;
let _days = [];

const MEAL_TYPE_EMOJI = {
  breakfast: '🌅',
  lunch:     '☀️',
  dinner:    '🌙',
  snack:     '🍎',
};

// ─── Load & render ────────────────────────────────────────
export async function loadAndRenderPlan() {
  const result = await fetchActivePlan();
  _plan = result.plan;
  _days = result.days;
  renderPlan();
}

function renderPlan() {
  const container = document.getElementById('mealPlanContent');
  if (!container) return;

  if (!_plan || _days.length === 0) {
    container.innerHTML = `<p class="empty-state">No active meal plan found.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="plan-header">
      <h2 class="plan-title">${_plan.name || 'Weekly Meal Plan'}</h2>
      ${_plan.week_focus ? `<p class="plan-focus">${_plan.week_focus}</p>` : ''}
    </div>
    <div class="days-list">
      ${_days.map(day => renderDayCard(day)).join('')}
    </div>
  `;

  // Bind cooked toggles
  container.querySelectorAll('[data-meal-id]').forEach(el => {
    el.querySelector('.btn-cooked')?.addEventListener('click', () => {
      toggleCooked(el.dataset.mealId);
    });
    el.querySelector('.btn-steps')?.addEventListener('click', () => {
      const stepsEl = el.querySelector('.steps-list');
      if (!stepsEl) return;
      stepsEl.classList.toggle('steps-open');
      el.querySelector('.btn-steps').textContent =
        stepsEl.classList.contains('steps-open') ? 'Hide steps ▲' : 'Show steps ▼';
    });
  });
}

// ─── Day card ─────────────────────────────────────────────
function renderDayCard(day) {
  const allCooked = day.meals.length > 0 && day.meals.every(m => m.cooked);

  return `
    <div class="day-card ${allCooked ? 'day-card--done' : ''}" data-day-id="${day.id}">
      <div class="day-header">
        <span class="day-label">${day.day_label || 'Day ' + day.sort_order}</span>
        ${day.focus ? `<span class="day-focus">${day.focus}</span>` : ''}
        ${allCooked ? `<span class="day-badge">✅ Done</span>` : ''}
      </div>
      <div class="meals-list">
        ${day.meals.map(meal => renderMealCard(meal)).join('')}
      </div>
    </div>
  `;
}

// ─── Meal card ────────────────────────────────────────────
function renderMealCard(meal) {
  const emoji   = MEAL_TYPE_EMOJI[meal.meal_type] || '🍽️';
  const cooked  = meal.cooked;
  const cookedCls = cooked ? 'meal-card--cooked' : '';

  // Csilla's macros (stored in DB)
  const cMacros = {
    kcal:    meal.kcal_csilla    ?? 0,
    protein: meal.protein_csilla ?? 0,
    carbs:   meal.carbs_csilla   ?? 0,
    fat:     meal.fat_csilla     ?? 0,
  };

  // Ralph's macros (scaled from Csilla's)
  const rMacros = {
    kcal:    Math.round(cMacros.kcal    * RALPH_MULTIPLIERS.kcal),
    protein: Math.round(cMacros.protein * RALPH_MULTIPLIERS.protein),
    carbs:   Math.round(cMacros.carbs   * RALPH_MULTIPLIERS.carbs),
    fat:     Math.round(cMacros.fat     * RALPH_MULTIPLIERS.fat),
  };

  const priorityChips = (meal.priority || [])
    .map(p => `<span class="priority-chip">${p.label}</span>`)
    .join('');

  const ingredientsList = (meal.ingredients || [])
    .map(i => {
      const qty = i.quantity_csilla ? `${i.quantity_csilla}${i.unit ? ' ' + i.unit : ''}` : '';
      return `<li><span class="ing-name">${i.name}</span>${qty ? `<span class="ing-qty">${qty}</span>` : ''}</li>`;
    })
    .join('');

  const stepsList = (meal.steps || [])
    .sort((a, b) => a.step_order - b.step_order)
    .map(s => `<li class="step-item">${s.instruction}</li>`)
    .join('');

  const hasSteps = meal.steps && meal.steps.length > 0;

  return `
    <div class="meal-card ${cookedCls}" data-meal-id="${meal.id}">
      <div class="meal-header">
        <span class="meal-type-emoji">${emoji}</span>
        <span class="meal-name">${meal.name}</span>
        <button class="btn-cooked" title="${cooked ? 'Mark uncooked' : 'Mark cooked'}">
          ${cooked ? '↩' : '✓'}
        </button>
      </div>

      ${priorityChips ? `<div class="priority-chips">${priorityChips}</div>` : ''}

      <div class="macros-row">
        <div class="macros-person">
          <span class="macros-label">Csilla</span>
          <span class="macro-pill">${cMacros.kcal} kcal</span>
          <span class="macro-pill">${cMacros.protein}g P</span>
          <span class="macro-pill">${cMacros.carbs}g C</span>
          <span class="macro-pill">${cMacros.fat}g F</span>
        </div>
        <div class="macros-person">
          <span class="macros-label">Ralph</span>
          <span class="macro-pill">${rMacros.kcal} kcal</span>
          <span class="macro-pill">${rMacros.protein}g P</span>
          <span class="macro-pill">${rMacros.carbs}g C</span>
          <span class="macro-pill">${rMacros.fat}g F</span>
        </div>
      </div>

      ${ingredientsList ? `
        <ul class="ingredients-list">${ingredientsList}</ul>
      ` : ''}

      ${hasSteps ? `
        <button class="btn-steps">Show steps ▼</button>
        <ol class="steps-list">${stepsList}</ol>
      ` : ''}
    </div>
  `;
}

// ─── Cooked toggle ────────────────────────────────────────
async function toggleCooked(mealId) {
  // Find meal across all days
  let targetMeal = null;
  for (const day of _days) {
    targetMeal = day.meals.find(m => m.id === mealId);
    if (targetMeal) break;
  }
  if (!targetMeal) return;

  const newCooked = !targetMeal.cooked;
  targetMeal.cooked      = newCooked;
  targetMeal.cooked_date = newCooked ? new Date().toISOString().slice(0, 10) : null;

  // Optimistic re-render
  renderPlan();

  // Persist to DB
  await setMealCooked(mealId, newCooked);
}
