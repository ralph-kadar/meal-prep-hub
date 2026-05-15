// ─── Meal Plan Module ─────────────────────────────────────
import { fetchActivePlan, fetchPantry, fetchCookLog,
         markMealCookedWithDeductions, unmarkMealCooked } from './supabase.js';
import { RALPH_MULTIPLIERS, PROFILES }                    from './config.js';
import { flashSaved, getDefaultRemaining }                  from './ui.js';

// ─── Module state ─────────────────────────────────────────
let _plan         = null;
let _days         = [];
let _activeDay    = 0;
let _pantryItems  = {};   // { pantry_item_id → pantry_item row }
let _cookLog      = {};   // { meal_id → deductions[] }   (local cache of meal_cook_log)

// Cook-panel state (only one panel open at a time)
let _openCookKey    = null;   // "${dayIdx}-${mealIdx}" or null
let _cookSelections = {};     // { pantry_item_id → pct }  (-1|0|25|50|75)

const TYPE_LABEL = {
  breakfast: '🌅 Breakfast',
  lunch:     '☀️ Lunch',
  dinner:    '🌙 Dinner',
  snack:     '🍎 Snack',
};

const TYPE_CLASS = {
  breakfast: 'breakfast',
  lunch:     'lunch',
  dinner:    'dinner',
  snack:     'snack',
};

// ─── Load & render ────────────────────────────────────────
export async function loadAndRenderPlan() {
  const result = await fetchActivePlan();
  _plan = result.plan;
  _days = result.days;
  _activeDay = 0;

  // Fetch pantry items and cook log in parallel
  const allMealIds = _days.flatMap(d => d.meals.map(m => m.id));
  const [pantryData, logData] = await Promise.all([
    fetchPantry(),
    fetchCookLog(allMealIds),
  ]);

  _pantryItems = Object.fromEntries(pantryData.map(p => [p.id, p]));
  _cookLog     = Object.fromEntries(logData.map(l => [l.meal_id, l.deductions]));

  renderShell();
  bindEvents();
  renderDayNav();
  renderDayView();
}

// ─── Shell ────────────────────────────────────────────────
function renderShell() {
  const container = document.getElementById('tab-plan');
  if (!container) return;

  if (!_plan || _days.length === 0) {
    container.innerHTML = `<p class="empty-state">No active meal plan found.</p>`;
    return;
  }

  const ralph  = PROFILES.ralph;
  const csilla = PROFILES.csilla;

  container.innerHTML = `
    <div class="meal-page-header">
      <div>
        <h2>🗓️ ${escHtml(_plan.week_label || '5-Day Meal Plan')}</h2>
        <p>${escHtml(_plan.week_focus || 'Prioritising what expires first · Tailored for Ralph & Csilla')}</p>
      </div>
    </div>

    <div class="caloric-guide">
      <div class="person-chip">
        <strong>${ralph.name} · ${ralph.age}y · ${ralph.height}cm · ${ralph.weight}kg</strong>
        Target: ~${ralph.kcal.toLocaleString()} kcal/day &nbsp;·&nbsp; Protein ~${ralph.protein}g &nbsp;·&nbsp; Carbs ~${ralph.carbs}g &nbsp;·&nbsp; Fat ~${ralph.fat}g
      </div>
      <div class="person-chip">
        <strong>${csilla.name} · ${csilla.age}y · ${csilla.height}cm · ${csilla.weight}kg</strong>
        Target: ~${csilla.kcal.toLocaleString()} kcal/day &nbsp;·&nbsp; Protein ~${csilla.protein}g &nbsp;·&nbsp; Carbs ~${csilla.carbs}g &nbsp;·&nbsp; Fat ~${csilla.fat}g
      </div>
      <div class="person-chip portion-note">
        <strong>📏 Portion note</strong>
        Macros shown per Csilla's serving. Ralph: +25–30% on grains &amp; protein.
      </div>
    </div>

    <div class="day-nav" id="dayNav"></div>
    <div class="day-view" id="dayView"></div>
  `;

  // Inject recipe modal once into body
  if (!document.getElementById('recipeModalOverlay')) {
    const overlay = document.createElement('div');
    overlay.id        = 'recipeModalOverlay';
    overlay.className = 'modal-overlay';
    overlay.dataset.action = 'close-modal';
    overlay.innerHTML = `
      <div class="modal" id="recipeModal">
        <div class="modal-top" id="modalTop">
          <button class="close-btn" data-action="close-modal">✕</button>
          <span class="meal-type-badge" id="modalBadge"></span>
          <h2 id="modalTitle"></h2>
          <p id="modalTagline"></p>
        </div>
        <div class="modal-body" id="modalBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

// ─── Event delegation ─────────────────────────────────────
function bindEvents() {
  const container = document.getElementById('tab-plan');
  if (!container) return;

  container.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    switch (target.dataset.action) {

      case 'set-day': {
        _activeDay = parseInt(target.dataset.dayIdx, 10);
        renderDayNav();
        renderDayView();
        break;
      }

      case 'open-modal': {
        // Don't open modal when click came from the cook area
        if (e.target.closest('.cook-btn-wrap, .cook-panel')) break;
        openModal(
          parseInt(target.dataset.dayIdx,  10),
          parseInt(target.dataset.mealIdx, 10)
        );
        break;
      }

      case 'toggle-cook-panel': {
        e.stopPropagation();
        toggleCookPanel(
          parseInt(target.dataset.dayIdx,  10),
          parseInt(target.dataset.mealIdx, 10)
        );
        break;
      }

      case 'set-cook-sel': {
        e.stopPropagation();
        const itemId = target.dataset.itemId;
        const pct    = parseInt(target.dataset.pct, 10);
        _cookSelections[itemId] = pct;
        // DOM-only chip highlight — no re-render
        const row = document.getElementById(`csel-${CSS.escape(itemId)}`);
        if (row) {
          row.querySelectorAll('button').forEach(b =>
            b.classList.toggle('sel', parseInt(b.dataset.pct, 10) === pct)
          );
        }
        break;
      }

      case 'confirm-cooked': {
        e.stopPropagation();
        confirmCooked(
          parseInt(target.dataset.dayIdx,  10),
          parseInt(target.dataset.mealIdx, 10)
        );
        break;
      }

      case 'unmark-cooked': {
        e.stopPropagation();
        unmarkCooked(target.dataset.mealId);
        break;
      }

      case 'panel-noop':
        // Absorb click so it doesn't bubble to open-modal
        break;
    }
  });

  // Close modal on overlay click or Escape
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// ─── Day nav ──────────────────────────────────────────────
function renderDayNav() {
  const nav = document.getElementById('dayNav');
  if (!nav) return;

  nav.innerHTML = _days.map((day, i) => {
    const allCooked = day.meals.length > 0 && day.meals.every(m => m.cooked);
    return `
      <div class="day-pill${i === _activeDay ? ' active' : ''}"
           data-action="set-day" data-day-idx="${i}">
        <div class="dpname">${escHtml(day.day_label || 'Day ' + day.sort_order)}</div>
        <div class="dpdate">${dayShortDate(i)}</div>
        <div class="dpfocus">${escHtml(day.focus || '')}</div>
        ${allCooked ? '<div class="urgency-dot" style="background:var(--accent)"></div>' : ''}
      </div>
    `;
  }).join('');
}

// ─── Day view ─────────────────────────────────────────────
function renderDayView() {
  const view = document.getElementById('dayView');
  if (!view) return;

  const day = _days[_activeDay];
  if (!day) return;

  const cTot = dayTotals(day.meals, false);
  const rTot = dayTotals(day.meals, true);

  view.innerHTML = `
    <div class="day-total-card">
      <div class="day-total-title">📊 Day Total</div>
      <div class="day-total-row">
        <div class="day-total-person">
          <div class="day-total-label">👩 Csilla</div>
          <div class="day-total-macros">
            <span><strong style="color:var(--accent)">${cTot.kcal}</strong> kcal</span>
            <span><strong style="color:#c0392b">${cTot.protein}g</strong> P</span>
            <span><strong style="color:#e67e22">${cTot.carbs}g</strong> C</span>
            <span><strong style="color:#2980b9">${cTot.fat}g</strong> F</span>
          </div>
        </div>
        <div class="day-total-person">
          <div class="day-total-label ralph">🧑 Ralph</div>
          <div class="day-total-macros">
            <span><strong style="color:var(--accent)">${rTot.kcal}</strong> kcal</span>
            <span><strong style="color:#c0392b">${rTot.protein}g</strong> P</span>
            <span><strong style="color:#e67e22">${rTot.carbs}g</strong> C</span>
            <span><strong style="color:#2980b9">${rTot.fat}g</strong> F</span>
          </div>
        </div>
      </div>
    </div>
    <div class="meals-grid">
      ${day.meals.map((meal, mi) => renderMealCard(meal, _activeDay, mi)).join('')}
    </div>
  `;
}

// ─── Meal card ────────────────────────────────────────────
function renderMealCard(meal, dayIdx, mealIdx) {
  const cm      = cMacros(meal);
  const rm      = rMacros(cm);
  const cooked  = meal.cooked;
  const typeKey = meal.meal_type || 'dinner';

  const priorityTags = (meal.priority || [])
    .map(p => `<span class="priority-tag${p.urgent ? ' urgent' : ''}">${p.urgent ? '⚡ ' : ''}${escHtml(p.label)}</span>`)
    .join('');

  return `
    <div class="meal-card${cooked ? ' meal-card--cooked' : ''}"
         data-action="open-modal" data-day-idx="${dayIdx}" data-meal-idx="${mealIdx}"
         style="${cooked ? 'opacity:0.75' : ''}">
      <div class="meal-card-header">
        <div class="meal-emoji">${escHtml(meal.emoji || '🍽️')}</div>
        <div class="meal-info">
          <span class="meal-type-badge ${TYPE_CLASS[typeKey] || ''}">${TYPE_LABEL[typeKey] || typeKey}</span>
          <div class="meal-name">${escHtml(meal.name)}</div>
          ${meal.tagline ? `<div class="meal-tagline">${escHtml(meal.tagline)}</div>` : ''}
        </div>
      </div>
      ${priorityTags ? `<div class="priority-tags">${priorityTags}</div>` : ''}
      <div class="macro-table">
        <div class="macro-row">
          <div class="macro-person">👩 Csilla</div>
          <div class="macro-cell" style="color:var(--accent)">${cm.kcal}<span> kcal</span></div>
          <div class="macro-cell" style="color:#c0392b">${cm.protein}g<span> P</span></div>
          <div class="macro-cell" style="color:#e67e22">${cm.carbs}g<span> C</span></div>
          <div class="macro-cell" style="color:#2980b9">${cm.fat}g<span> F</span></div>
        </div>
        <div class="macro-row">
          <div class="macro-person">🧑 Ralph</div>
          <div class="macro-cell" style="color:var(--accent)">${rm.kcal}<span> kcal</span></div>
          <div class="macro-cell" style="color:#c0392b">${rm.protein}g<span> P</span></div>
          <div class="macro-cell" style="color:#e67e22">${rm.carbs}g<span> C</span></div>
          <div class="macro-cell" style="color:#2980b9">${rm.fat}g<span> F</span></div>
        </div>
      </div>
      <div class="expand-hint">Tap to see recipe &amp; steps →</div>
      ${cookAreaHtml(meal, dayIdx, mealIdx)}
    </div>
  `;
}

// ─── Cook area (bottom of meal card) ─────────────────────
function cookAreaHtml(meal, dayIdx, mealIdx) {
  // Already cooked → show stamp with undo
  if (meal.cooked) {
    return `
      <div class="cooked-stamp">
        ✅ Cooked${meal.cooked_date ? ' ' + meal.cooked_date : ''}
        <button class="uncook-link"
                data-action="unmark-cooked"
                data-meal-id="${meal.id}">undo</button>
      </div>`;
  }

  const cookKey   = `${dayIdx}-${mealIdx}`;
  const panelOpen = _openCookKey === cookKey;

  return `
    <div class="cook-btn-wrap" data-action="panel-noop">
      <button class="cook-btn${panelOpen ? ' cook-btn--open' : ''}"
              data-action="toggle-cook-panel"
              data-day-idx="${dayIdx}" data-meal-idx="${mealIdx}">
        ${panelOpen ? '✕ Cancel' : '🍳 Mark as cooked'}
      </button>
    </div>
    ${panelOpen ? `<div class="cook-panel" data-action="panel-noop">${buildCookPanelHtml(meal, dayIdx, mealIdx)}</div>` : ''}
  `;
}

// ─── Cook panel HTML ──────────────────────────────────────
function buildCookPanelHtml(meal, dayIdx, mealIdx) {
  const cookKey = `${dayIdx}-${mealIdx}`;

  // Ingredients that have a pantry link and aren't already fully used
  const panelRows = (meal.ingredients || [])
    .filter(i => i.pantry_item_id && _pantryItems[i.pantry_item_id] && !_pantryItems[i.pantry_item_id].used)
    .map(ing => {
      const item  = _pantryItems[ing.pantry_item_id];
      const amtStr = [ing.quantity_csilla, ing.unit].filter(Boolean).join(' ');
      // Resolve selection: explicit chip choice, or smart default
      const sel = _cookSelections[ing.pantry_item_id] !== undefined
        ? _cookSelections[ing.pantry_item_id]
        : getDefaultRemaining(ing, item);

      const chips = [
        { pct:  0, label: 'All gone' },
        { pct: 25, label: '25% left' },
        { pct: 50, label: '50% left' },
        { pct: 75, label: '75% left' },
        { pct: -1, label: 'Skip',     cls: 'skip-btn' },
      ].map(o => `
        <button class="${o.cls || ''}${sel === o.pct ? ' sel' : ''}"
                data-action="set-cook-sel"
                data-item-id="${escHtml(ing.pantry_item_id)}"
                data-pct="${o.pct}">${o.label}</button>
      `).join('');

      return `
        <div class="cook-item">
          <div class="cook-item-top">
            <span class="cing-name">${escHtml(item.name)}</span>
            ${amtStr ? `<span class="cing-amt">${escHtml(amtStr)}</span>` : ''}
          </div>
          <div class="cook-sel" id="csel-${escHtml(ing.pantry_item_id)}">${chips}</div>
        </div>
      `;
    });

  if (panelRows.length === 0) {
    return `
      <p class="cook-no-match">All pantry items for this meal are already marked used.</p>
      <button class="cook-confirm-btn"
              data-action="confirm-cooked"
              data-day-idx="${dayIdx}" data-meal-idx="${mealIdx}">✓ Mark cooked anyway</button>
    `;
  }

  return `
    <span class="cook-panel-label">🍳 How much of each ingredient is left after cooking?</span>
    ${panelRows.join('')}
    <button class="cook-confirm-btn"
            data-action="confirm-cooked"
            data-day-idx="${dayIdx}" data-meal-idx="${mealIdx}">✓ Update pantry</button>
  `;
}

// getDefaultRemaining is now in ui.js — imported above.

// ─── Toggle cook panel open/closed ────────────────────────
function toggleCookPanel(dayIdx, mealIdx) {
  const cookKey = `${dayIdx}-${mealIdx}`;
  if (_openCookKey === cookKey) {
    // Close
    _openCookKey    = null;
    _cookSelections = {};
  } else {
    // Open — pre-fill smart defaults for all pantry-linked ingredients
    _openCookKey    = cookKey;
    _cookSelections = {};
    const day  = _days[dayIdx];
    const meal = day?.meals[mealIdx];
    if (meal) {
      for (const ing of meal.ingredients || []) {
        if (ing.pantry_item_id && _pantryItems[ing.pantry_item_id]
            && !_pantryItems[ing.pantry_item_id].used) {
          _cookSelections[ing.pantry_item_id] = getDefaultRemaining(ing, _pantryItems[ing.pantry_item_id]);
        }
      }
    }
  }
  renderDayView();
}

// ─── Confirm cook: apply deductions ───────────────────────
function confirmCooked(dayIdx, mealIdx) {
  const day  = _days[dayIdx];
  const meal = day?.meals[mealIdx];
  if (!meal) return;

  // Build deductions array (one entry per panel row)
  const deductions = (meal.ingredients || [])
    .filter(i => i.pantry_item_id && _pantryItems[i.pantry_item_id])
    .map(ing => {
      const item = _pantryItems[ing.pantry_item_id];
      // Default to smart default if chip was never touched
      const appliedPct = _cookSelections[ing.pantry_item_id] !== undefined
        ? _cookSelections[ing.pantry_item_id]
        : (item.used ? -1 : getDefaultRemaining(ing, item));

      return {
        pantry_item_id: ing.pantry_item_id,
        prev_used:      item.used              ?? false,
        prev_partial:   item.partial_remaining ?? null,
        applied_pct:    appliedPct,
      };
    })
    .filter(d => d.pantry_item_id); // safety: skip nulls

  // ── Optimistic: apply deductions locally ──────────────
  const pantrySnapshot = {};
  for (const d of deductions) {
    pantrySnapshot[d.pantry_item_id] = { ...(_pantryItems[d.pantry_item_id] || {}) };
    if (d.applied_pct === -1) continue;
    const item = _pantryItems[d.pantry_item_id];
    if (!item) continue;
    if (d.applied_pct === 0) {
      item.used              = true;
      item.partial_remaining = null;
    } else {
      item.used              = false;
      item.partial_remaining = d.applied_pct;
    }
  }

  // Optimistic: flip meal state
  const prevCooked    = meal.cooked;
  const prevCookedDate = meal.cooked_date;
  meal.cooked      = true;
  meal.cooked_date = new Date().toISOString().slice(0, 10);

  // Cache log for optimistic undo
  _cookLog[meal.id] = deductions;

  // Close panel
  _openCookKey    = null;
  _cookSelections = {};

  renderDayNav();
  renderDayView();
  flashSaved();

  // ── Persist to DB ─────────────────────────────────────
  markMealCookedWithDeductions(meal.id, deductions).catch(err => {
    console.error('confirmCooked failed:', err);
    // Roll back
    meal.cooked      = prevCooked;
    meal.cooked_date = prevCookedDate;
    delete _cookLog[meal.id];
    for (const d of deductions) {
      if (_pantryItems[d.pantry_item_id] && pantrySnapshot[d.pantry_item_id]) {
        Object.assign(_pantryItems[d.pantry_item_id], pantrySnapshot[d.pantry_item_id]);
      }
    }
    renderDayNav();
    renderDayView();
    alert(`⚠️ Couldn't save: ${err.message}`);
  });
}

// ─── Undo cook ────────────────────────────────────────────
function unmarkCooked(mealId) {
  let meal = null;
  for (const day of _days) {
    meal = day.meals.find(m => m.id === mealId);
    if (meal) break;
  }
  if (!meal) return;

  // Optimistic: restore pantry from local log cache
  const logDeductions = _cookLog[mealId] || [];
  const pantrySnapshot = {};
  for (const d of logDeductions) {
    if (d.applied_pct === -1) continue;
    const item = _pantryItems[d.pantry_item_id];
    if (!item) continue;
    pantrySnapshot[d.pantry_item_id] = { ...item };
    item.used              = d.prev_used              ?? false;
    item.partial_remaining = d.prev_partial           ?? null;
  }

  const prevCooked    = meal.cooked;
  const prevCookedDate = meal.cooked_date;
  meal.cooked      = false;
  meal.cooked_date = null;
  delete _cookLog[mealId];

  renderDayNav();
  renderDayView();
  flashSaved();

  // Persist to DB
  unmarkMealCooked(mealId).catch(err => {
    console.error('unmarkCooked failed:', err);
    // Roll back
    meal.cooked      = prevCooked;
    meal.cooked_date = prevCookedDate;
    _cookLog[mealId] = logDeductions;
    for (const d of logDeductions) {
      if (_pantryItems[d.pantry_item_id] && pantrySnapshot[d.pantry_item_id]) {
        Object.assign(_pantryItems[d.pantry_item_id], pantrySnapshot[d.pantry_item_id]);
      }
    }
    renderDayNav();
    renderDayView();
    alert(`⚠️ Couldn't save: ${err.message}`);
  });
}

// ─── Recipe modal ─────────────────────────────────────────
function openModal(dayIdx, mealIdx) {
  const day  = _days[dayIdx];
  if (!day) return;
  const meal = day.meals[mealIdx];
  if (!meal) return;

  const typeKey = meal.meal_type || 'dinner';
  const cm = cMacros(meal);
  const rm = rMacros(cm);

  const topEl     = document.getElementById('modalTop');
  const badgeEl   = document.getElementById('modalBadge');
  const titleEl   = document.getElementById('modalTitle');
  const taglineEl = document.getElementById('modalTagline');
  const bodyEl    = document.getElementById('modalBody');
  if (!topEl) return;

  topEl.style.background = 'var(--accent)';
  topEl.style.color      = 'white';
  badgeEl.textContent    = TYPE_LABEL[typeKey] || typeKey;
  badgeEl.className      = `meal-type-badge ${TYPE_CLASS[typeKey] || ''}`;
  titleEl.textContent    = (meal.emoji || '') + ' ' + meal.name;
  taglineEl.textContent  = meal.tagline || '';

  const ingHtml = (meal.ingredients || []).map(i => {
    const qty = i.quantity_csilla ? `${i.quantity_csilla}${i.unit ? ' ' + i.unit : ''}` : '';
    return `<li>
      <div class="ingredient-dot"></div>
      <span><strong>${escHtml(i.name)}</strong>${qty ? ` — ${escHtml(qty)}` : ''}</span>
    </li>`;
  }).join('');

  const stepsHtml = (meal.steps || [])
    .sort((a, b) => a.step_order - b.step_order)
    .map((s, idx) => `<li><div class="step-num">${idx + 1}</div><span>${escHtml(s.instruction)}</span></li>`)
    .join('');

  const csilla = PROFILES.csilla;
  const ralph  = PROFILES.ralph;

  bodyEl.innerHTML = `
    <div class="modal-macro-grid">
      <div class="modal-person-block">
        <div class="modal-person-label csilla">👩 Csilla · ~${csilla.kcal.toLocaleString()} kcal/day</div>
        <div class="modal-person-macros">
          <div class="modal-pm kcal"><span class="mv">${cm.kcal}</span><span class="ml">Calories</span></div>
          <div class="modal-pm protein"><span class="mv">${cm.protein}g</span><span class="ml">Protein</span></div>
          <div class="modal-pm carbs"><span class="mv">${cm.carbs}g</span><span class="ml">Carbs</span></div>
          <div class="modal-pm fat"><span class="mv">${cm.fat}g</span><span class="ml">Fat</span></div>
        </div>
      </div>
      <div class="modal-person-block">
        <div class="modal-person-label ralph">🧑 Ralph · ~${ralph.kcal.toLocaleString()} kcal/day</div>
        <div class="modal-person-macros">
          <div class="modal-pm kcal"><span class="mv">${rm.kcal}</span><span class="ml">Calories</span></div>
          <div class="modal-pm protein"><span class="mv">${rm.protein}g</span><span class="ml">Protein</span></div>
          <div class="modal-pm carbs"><span class="mv">${rm.carbs}g</span><span class="ml">Carbs</span></div>
          <div class="modal-pm fat"><span class="mv">${rm.fat}g</span><span class="ml">Fat</span></div>
        </div>
      </div>
    </div>

    ${ingHtml ? `
    <div class="modal-section">
      <h3>🛒 Ingredients <span style="font-weight:400;font-size:0.75rem;color:var(--muted);text-transform:none;">(serves 2)</span></h3>
      <ul class="modal-ingredients-list">${ingHtml}</ul>
    </div>` : ''}

    ${stepsHtml ? `
    <div class="modal-section">
      <h3>👨‍🍳 Cooking Steps</h3>
      <ol class="modal-steps-list">${stepsHtml}</ol>
    </div>` : ''}

    ${meal.tip ? `
    <div class="modal-section">
      <h3>💡 Nutrition Tip</h3>
      <div class="tips-box">${escHtml(meal.tip)}</div>
    </div>` : ''}
  `;

  document.getElementById('recipeModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('recipeModalOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── Helpers ──────────────────────────────────────────────
function cMacros(meal) {
  return {
    kcal:    meal.kcal_csilla    ?? 0,
    protein: meal.protein_csilla ?? 0,
    carbs:   meal.carbs_csilla   ?? 0,
    fat:     meal.fat_csilla     ?? 0,
  };
}

function rMacros(c) {
  return {
    kcal:    Math.round(c.kcal    * RALPH_MULTIPLIERS.kcal),
    protein: Math.round(c.protein * RALPH_MULTIPLIERS.protein),
    carbs:   Math.round(c.carbs   * RALPH_MULTIPLIERS.carbs),
    fat:     Math.round(c.fat     * RALPH_MULTIPLIERS.fat),
  };
}

function dayTotals(meals, useRalph) {
  const c = {
    kcal:    meals.reduce((s, m) => s + (m.kcal_csilla    ?? 0), 0),
    protein: meals.reduce((s, m) => s + (m.protein_csilla ?? 0), 0),
    carbs:   meals.reduce((s, m) => s + (m.carbs_csilla   ?? 0), 0),
    fat:     meals.reduce((s, m) => s + (m.fat_csilla     ?? 0), 0),
  };
  return useRalph ? rMacros(c) : c;
}

function dayShortDate(idx) {
  const d = new Date();
  d.setDate(d.getDate() + idx);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
