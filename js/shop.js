// ─── Shop Module ─────────────────────────────────────────────
// Three-layer shopping assistant for Saturday-cadence grocery planning.
//
//   Layer 1 — Gap-fill  (Phase A): deterministic, recomputed every render.
//   Layer 2 — Essentials watch (Phase B): essential-tagged items running low.
//   Layer 3 — Predictive (Phase C): Opus writes shopping_predictions via MCP.
//   Tick + mark-bought (Phase D): localStorage ticks → bulk-add to pantry.

import {
  fetchPantry,
  fetchActivePlan,
  fetchActivePredictions,
  insertPrediction,
  markPredictionBought,
  fetchRecentCookedMeals,
} from './supabase.js';

import {
  nextSaturday,
  perishabilityExpiryDays,
  getDefaultRemaining,
  catEmoji,
  flashSaved,
} from './ui.js';

import { openBulkAddModal } from './pantry.js';

// ─── State ────────────────────────────────────────────────────
let _pantry       = [];
let _pantryById   = {};
let _plan         = null;
let _days         = [];
let _predictions  = [];   // active shopping_predictions rows
let _gapRows      = [];   // computed at render time — never persisted
let _thisSaturday = '';   // ISO date string e.g. "2026-05-16"
let _nextSaturday = '';   // ISO date string e.g. "2026-05-23"

const TICKS_KEY    = 'mealprep-shop-ticks';
const COLLAPSE_KEY = 'mealprep-shop-collapse';

// ─── Entry point ─────────────────────────────────────────────
export async function loadAndRenderShop() {
  const container = document.getElementById('tab-shop');
  if (!container) return;
  container.innerHTML = `<p class="loading-state">Loading shop…</p>`;

  // Compute Saturdays before any async work
  _thisSaturday = nextSaturday();
  const nextSat = new Date(_thisSaturday + 'T00:00:00');
  nextSat.setDate(nextSat.getDate() + 7);
  _nextSaturday = nextSat.toISOString().slice(0, 10);

  try {
    await refreshData();
    renderShell();
    bindEvents();
    renderContent();
  } catch (err) {
    console.error('loadAndRenderShop failed:', err);
    container.innerHTML = `<p class="error-state">⚠️ Failed to load — ${escHtml(err.message)}</p>`;
  }
}

// ─── Data fetch ──────────────────────────────────────────────
async function refreshData() {
  const [pantry, planResult, predictions] = await Promise.all([
    fetchPantry(),
    fetchActivePlan().catch(() => null),
    fetchActivePredictions(),
  ]);

  _pantry      = pantry;
  _pantryById  = Object.fromEntries(pantry.map(p => [p.id, p]));
  _plan        = planResult?.plan  || null;
  _days        = planResult?.days  || [];
  _predictions = predictions;
  _gapRows     = computeGapFill();
}

// ─── Shell ───────────────────────────────────────────────────
function renderShell() {
  const container = document.getElementById('tab-shop');
  if (!container) return;

  container.innerHTML = `
    <div class="shop-header">
      <div class="shop-header-title">
        🛒 Shopping list &nbsp;·&nbsp;
        <span style="font-weight:400; color:var(--muted); font-size:0.82rem;">
          This Saturday: ${formatSaturday(_thisSaturday)}
        </span>
      </div>
      <button class="shop-predict-btn" id="shopPredictBtn">
        🔮 Plan next 2 Saturdays
      </button>
    </div>

    <!-- Running low (Phase B) — rendered into this anchor -->
    <div id="shopRunningLow"></div>

    <!-- This Saturday -->
    <div class="shop-section" id="shopThisSat">
      <div class="shop-section-header" data-section="this-sat">
        <h3>🛒 This Saturday <span id="thisSatDate" style="font-weight:400;font-size:0.82rem;color:var(--muted);">(${formatSaturday(_thisSaturday)})</span></h3>
        <span class="shop-section-chevron">▼</span>
      </div>
      <div class="shop-section-body" id="thisSatBody"></div>
    </div>

    <!-- Coming Saturdays -->
    <div class="shop-section" id="shopFuture">
      <div class="shop-section-header" data-section="future">
        <h3>📅 Coming Saturdays</h3>
        <span class="shop-section-chevron">▼</span>
      </div>
      <div class="shop-section-body" id="futureBody"></div>
    </div>

    <!-- Footer -->
    <div class="shop-footer">
      <span class="shop-ticked-count" id="shopTickedCount"></span>
      <button class="footer-btn cancel" id="shopCopyBtn" style="display:none">📋 Copy ticked as text</button>
      <button class="footer-btn save"   id="shopBoughtBtn" style="display:none">✅ Mark ticked as bought</button>
    </div>

    <!-- Prompt modal (Phase C) — injected into body -->
  `;
}

// ─── Events ──────────────────────────────────────────────────
function bindEvents() {
  const container = document.getElementById('tab-shop');
  if (!container) return;

  container.addEventListener('click', e => {
    // Section collapse toggle
    const secHeader = e.target.closest('.shop-section-header');
    if (secHeader) {
      toggleSection(secHeader.dataset.section);
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset;
    if (!action) return;

    if (action.action === 'tick-row')      toggleTick(action.id);
    if (action.action === 'add-essential') addEssentialToSaturday(action.id);
    if (action.action === 'shop-copy')     copyTickedAsText();
    if (action.action === 'shop-bought')   markBought();
    if (action.action === 'shop-predict')  openPredictFlow();
    if (action.action === 'shop-refresh')  refreshAndRender();
    if (action.action === 'close-confirm') closeConfirmModal();
  });

  // Checkbox inputs delegate through the row click above via data-action,
  // but also handle direct checkbox change for accessibility.
  container.addEventListener('change', e => {
    if (e.target.classList.contains('shop-row-check')) {
      toggleTick(e.target.dataset.id);
    }
  });
}

// ─── Content rendering ───────────────────────────────────────
function renderContent() {
  renderRunningLow();

  const ticks = loadTicks();

  // Split predictions by Saturday
  const satPreds    = _predictions.filter(p => p.buy_by_saturday === _thisSaturday);
  const futurePreds = _predictions.filter(p => p.buy_by_saturday > _thisSaturday);

  // Dedup: gap-fill wins over predictions for same category::name on this Saturday
  const dedupedSatPreds = dedupPredictions(_gapRows, satPreds);

  renderThisSaturday([..._gapRows, ...dedupedSatPreds], ticks);
  renderComingSaturdays(futurePreds, ticks);
  updateFooter(ticks);
  applyCollapseState();
}

// ─── Running low (Phase B placeholder) ───────────────────────
function renderRunningLow() {
  const el = document.getElementById('shopRunningLow');
  if (!el) return;

  const essentials = computeEssentials();
  if (!essentials.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="shop-section">
      <div class="shop-section-header" data-section="running-low">
        <h3>🚨 Running low <span style="font-size:0.8rem;font-weight:400;color:#d35400;">(${essentials.length})</span></h3>
        <span class="shop-section-chevron">▼</span>
      </div>
      <div class="shop-section-body" id="runningLowBody">
        <div class="running-low-list">
          ${essentials.map(item => renderRunningLowCard(item)).join('')}
        </div>
      </div>
    </div>`;
}

function renderRunningLowCard(item) {
  const remaining = item.used ? 0 : (item.partial_remaining ?? 100);
  const status    = item.used
    ? 'Fully used'
    : remaining === 0
      ? 'All gone'
      : `${remaining}% remaining`;

  // Check if already added to this Saturday's list
  const alreadyAdded = _predictions.some(
    p => p.buy_by_saturday === _thisSaturday &&
         p.name.toLowerCase() === item.name.toLowerCase()
  );

  const btn = alreadyAdded
    ? `<span class="essential-added-lbl">✓ On list</span>`
    : `<button class="essential-add-btn" data-action="add-essential" data-id="${item.id}">🛒 Add to Saturday</button>`;

  return `
    <div class="running-low-card">
      <div class="running-low-info">
        <div class="running-low-name">${catEmoji(item.category)} ${escHtml(item.name)}</div>
        <div class="running-low-status">${escHtml(status)}${item.expiry_date ? ` · expires ${item.expiry_date}` : ''}</div>
      </div>
      ${btn}
    </div>`;
}

// ─── This Saturday section ────────────────────────────────────
function renderThisSaturday(rows, ticks) {
  const body = document.getElementById('thisSatBody');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<p class="shop-empty">No items needed this Saturday. Enjoy your shop! 🎉</p>`;
    return;
  }

  body.innerHTML = renderGroupedRows(rows, ticks);
}

// ─── Coming Saturdays section ─────────────────────────────────
function renderComingSaturdays(rows, ticks) {
  const body = document.getElementById('futureBody');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<p class="shop-empty">No upcoming predictions yet. Hit 🔮 to generate some.</p>`;
    return;
  }

  // Group by buy_by_saturday
  const bySat = {};
  for (const row of rows) {
    (bySat[row.buy_by_saturday] ??= []).push(row);
  }

  body.innerHTML = Object.entries(bySat)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([sat, satRows]) => `
      <div style="margin-bottom: 16px;">
        <div style="font-weight:700; font-size:0.82rem; color:var(--accent); margin-bottom:8px;">
          Saturday ${formatSaturday(sat)}
        </div>
        ${renderGroupedRows(satRows, ticks)}
      </div>`)
    .join('');
}

// ─── Render rows grouped by category ─────────────────────────
function renderGroupedRows(rows, ticks) {
  // Group by category
  const byCat = {};
  for (const row of rows) {
    const cat = row.category || 'Other';
    (byCat[cat] ??= []).push(row);
  }

  return Object.entries(byCat)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, catRows]) => `
      <div class="shop-category-group">
        <div class="shop-category-label">${catEmoji(cat)} ${escHtml(cat)}</div>
        ${catRows.map(row => renderShopRow(row, ticks)).join('')}
      </div>`)
    .join('');
}

// ─── Single shop row ──────────────────────────────────────────
function renderShopRow(row, ticks) {
  const isTicked  = !!ticks[row.id];
  const sourcePill = row.source === 'gap_fill'
    ? `<span class="source-pill plan">Plan</span>`
    : `<span class="source-pill predicted">Predicted</span>`;

  const perishDot = row.perishability_level
    ? `<span class="perish-dot ${row.perishability_level}" title="${row.perishability_level}"></span>`
    : '';

  const reason = row.reason
    ? `<span class="shop-row-reason">${escHtml(row.reason)}</span>`
    : '';

  return `
    <div class="shop-row ${isTicked ? 'ticked' : ''}" data-row-id="${row.id}">
      <input type="checkbox" class="shop-row-check"
             data-action="tick-row" data-id="${escHtml(row.id)}"
             ${isTicked ? 'checked' : ''}>
      <div class="shop-row-content">
        <div class="shop-row-main">
          <span class="shop-row-name">${escHtml(row.name)}</span>
          ${row.qty ? `<span class="shop-row-qty">${escHtml(row.qty)}</span>` : ''}
        </div>
        <div class="shop-row-meta">
          ${perishDot}
          ${reason}
          ${sourcePill}
        </div>
      </div>
    </div>`;
}

// ─── Footer ───────────────────────────────────────────────────
function updateFooter(ticks) {
  const count     = Object.values(ticks).filter(Boolean).length;
  const countEl   = document.getElementById('shopTickedCount');
  const copyBtn   = document.getElementById('shopCopyBtn');
  const boughtBtn = document.getElementById('shopBoughtBtn');

  if (countEl)   countEl.textContent = count > 0 ? `${count} item${count !== 1 ? 's' : ''} ticked` : '';
  if (copyBtn)   copyBtn.style.display   = count > 0 ? 'inline-flex' : 'none';
  if (boughtBtn) boughtBtn.style.display = count > 0 ? 'inline-flex' : 'none';

  // Wire footer buttons (do it each time since the DOM is re-rendered)
  if (copyBtn)   copyBtn.setAttribute('data-action', 'shop-copy');
  if (boughtBtn) boughtBtn.setAttribute('data-action', 'shop-bought');
}

// ─── Gap-fill computation ─────────────────────────────────────
// Compares active plan ingredient needs vs pantry stock.
// Heuristic: each meal reference consumes ~30 % of the item.
// Cannot do exact comparisons because quantities are free-text.
function computeGapFill() {
  if (!_days.length) return [];

  const usage = {};  // pantry_item_id → { item, mealIds, ings }
  for (const day of _days) {
    for (const meal of (day.meals || [])) {
      for (const ing of (meal.ingredients || [])) {
        if (!ing.pantry_item_id || ing.is_pantry_staple) continue;
        const item = _pantryById[ing.pantry_item_id];
        if (!item) continue;
        if (!usage[ing.pantry_item_id]) {
          usage[ing.pantry_item_id] = { item, mealIds: new Set(), ings: [] };
        }
        usage[ing.pantry_item_id].mealIds.add(meal.id);
        usage[ing.pantry_item_id].ings.push(ing);
      }
    }
  }

  const gaps = [];
  for (const [id, { item, mealIds }] of Object.entries(usage)) {
    const available    = item.used ? 0 : (item.partial_remaining ?? 100);
    const mealCount    = mealIds.size;
    const estimatedNeed = Math.min(100, mealCount * 30);

    if (available < estimatedNeed) {
      gaps.push({
        id:              `gapfill_${id}`,
        name:            item.name,
        qty:             null,
        category:        item.category,
        buy_by_saturday: _thisSaturday,
        reason:          mealCount === 1
          ? 'Needed for a meal this week'
          : `Used in ${mealCount} meals this week`,
        source:          'gap_fill',
        perishability_level: item.perishability_level,
      });
    }
  }

  return gaps;
}

// ─── Essentials watch computation ────────────────────────────
function computeEssentials() {
  const todayStr = today();
  return _pantry.filter(item => {
    if (!(item.tags || []).includes('essential')) return false;
    if (item.used) return true;
    if ((item.partial_remaining ?? 100) <= 25) return true;
    if (item.expiry_date && item.expiry_date <= addDays(todayStr, 2)) return true;
    return false;
  });
}

// ─── Add essential to Saturday ───────────────────────────────
async function addEssentialToSaturday(pantryItemId) {
  const item = _pantryById[pantryItemId];
  if (!item) return;

  const btn = document.querySelector(`[data-action="add-essential"][data-id="${CSS.escape(pantryItemId)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

  try {
    const row = await insertPrediction({
      name:            item.name,
      qty:             null,
      category:        item.category,
      buy_by_saturday: _thisSaturday,
      reason:          'Essential running low',
      source:          'predicted',
      generated_by:    'essentials_watch',
    });
    _predictions.push(row);
    renderContent(); // re-render with new prediction in list
  } catch (err) {
    console.error('addEssentialToSaturday failed:', err);
    alert('Failed to add: ' + (err.message || 'Unknown error'));
    if (btn) { btn.disabled = false; btn.textContent = '🛒 Add to Saturday'; }
  }
}

// ─── Dedup: gap-fill wins over predictions ────────────────────
function dedupPredictions(gapRows, predRows) {
  const gapSet = new Set(
    gapRows.map(r => `${(r.category || '').toLowerCase()}::${r.name.toLowerCase()}`)
  );
  return predRows.filter(r =>
    !gapSet.has(`${(r.category || '').toLowerCase()}::${r.name.toLowerCase()}`)
  );
}

// ─── Section collapse ─────────────────────────────────────────
function toggleSection(key) {
  const collapse = loadCollapse();
  collapse[key]  = !collapse[key];
  saveCollapse(collapse);
  applyCollapseState();
}

function applyCollapseState() {
  const collapse = loadCollapse();
  document.querySelectorAll('.shop-section-header[data-section]').forEach(header => {
    const key       = header.dataset.section;
    const isCollapsed = !!collapse[key];
    header.classList.toggle('collapsed', isCollapsed);
    const body = header.nextElementSibling;
    if (body && body.classList.contains('shop-section-body')) {
      body.classList.toggle('hidden', isCollapsed);
    }
  });
}

// ─── Tick state ───────────────────────────────────────────────
function loadTicks()        { try { return JSON.parse(localStorage.getItem(TICKS_KEY) || '{}'); } catch { return {}; } }
function saveTicks(t)       { localStorage.setItem(TICKS_KEY, JSON.stringify(t)); }
function loadCollapse()     { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; } }
function saveCollapse(c)    { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(c)); }

function toggleTick(id) {
  const ticks  = loadTicks();
  ticks[id]    = !ticks[id];
  if (!ticks[id]) delete ticks[id];
  saveTicks(ticks);

  // DOM-only update — flip checkbox + row class without full re-render
  const row = document.querySelector(`[data-row-id="${CSS.escape(id)}"]`);
  if (row) {
    const isTicked = !!ticks[id];
    row.classList.toggle('ticked', isTicked);
    const cb = row.querySelector('.shop-row-check');
    if (cb) cb.checked = isTicked;
  }

  updateFooter(ticks);
}

function allVisibleRows() {
  return [..._gapRows, ..._predictions];
}

function tickedRows() {
  const ticks = loadTicks();
  return allVisibleRows().filter(r => ticks[r.id]);
}

// ─── Copy ticked as text ──────────────────────────────────────
async function copyTickedAsText() {
  const rows = tickedRows();
  if (!rows.length) return;

  const text = rows
    .map(r => `- ${r.qty ? r.qty + ' ' : ''}${r.name}${r.category ? ' (' + r.category + ')' : ''}`)
    .join('\n');

  try {
    await navigator.clipboard.writeText(text);
    flashSaved();
  } catch {
    alert('Copy failed — clipboard permission denied.');
  }
}

// ─── Mark ticked as bought → bulk-add modal (Phase D) ────────
function markBought() {
  const rows = tickedRows();
  if (!rows.length) {
    alert('Tick some items first.');
    return;
  }

  const prefills = rows.map(row => {
    const perish  = row.perishability_level || guessPLevel(row.category);
    const expDays = perishabilityExpiryDays(perish, row.category);
    return {
      name:                row.name,
      category:            row.category || null,
      quantity:            parseQty(row.qty),
      unit:                parseUnit(row.qty),
      perishability_level: perish,
      expiry_date:         addDays(today(), expDays),
      _predictionId:       row.source === 'predicted' ? row.id : null,
    };
  });

  openBulkAddModal(prefills, async (savedItems) => {
    // Mark predicted rows as bought in DB
    const predIds = rows
      .filter(r => r.source === 'predicted')
      .map(r => r.id);
    await Promise.all(predIds.map(id => markPredictionBought(id).catch(console.error)));

    // Update local predictions state
    for (const id of predIds) {
      const p = _predictions.find(p => p.id === id);
      if (p) p.bought_at = new Date().toISOString();
    }
    _predictions = _predictions.filter(p => !p.bought_at);

    // Clear ticks for bought rows
    const ticks = loadTicks();
    for (const row of rows) delete ticks[row.id];
    saveTicks(ticks);

    // Refresh gap-fill with updated pantry (savedItems already pushed into pantry by pantry.js)
    _pantry     = await fetchPantry();
    _pantryById = Object.fromEntries(_pantry.map(p => [p.id, p]));
    _gapRows    = computeGapFill();

    renderContent();
    flashSaved();
  });
}

// ─── Predictive flow — build prompt + copy to clipboard (Phase C) ──
async function openPredictFlow() {
  const btn = document.getElementById('shopPredictBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building prompt…'; }

  try {
    const prompt = await buildOpusPrompt();

    await navigator.clipboard.writeText(prompt).catch(async () => {
      // Clipboard API blocked — fall back to a textarea the user can copy from
      showPromptFallback(prompt);
      return;
    });

    showConfirmModal(
      '🔮 Prompt copied!',
      'Paste it into Cowork-Opus. Opus will write predictions directly to the database.\n\nWhen done, hit "Refresh predictions" to see them here.',
      [
        { label: '↻ Refresh predictions', action: 'shop-refresh', primary: true },
        { label: 'Close',                 action: 'close-confirm'              },
      ]
    );
  } catch (err) {
    console.error('openPredictFlow failed:', err);
    alert('Failed to build prompt: ' + (err.message || 'Unknown error'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔮 Plan next 2 Saturdays'; }
  }
}

async function refreshAndRender() {
  closeConfirmModal();
  const container = document.getElementById('tab-shop');
  if (container) {
    const prevScroll = window.scrollY;
    _predictions = await fetchActivePredictions();
    renderContent();
    requestAnimationFrame(() => window.scrollTo(0, prevScroll));
  }
}

// ─── Opus prompt builder ──────────────────────────────────────
async function buildOpusPrompt() {
  // Fetch recent cooked meals for Opus context
  const recentCooked = await fetchRecentCookedMeals(40);

  // Compute pantry state after this week's uncooked meals
  const pantryAfterPlan = computePantryAfterPlan();

  // Plant diversity from cooked meals this week
  const diversity = computePlantDiversity();

  // Build planned consumption context from active plan
  const plannedConsumption = [];
  for (const day of _days) {
    for (const meal of (day.meals || [])) {
      for (const ing of (meal.ingredients || [])) {
        if (!ing.pantry_item_id) continue;
        plannedConsumption.push({
          meal_day:       day.day_label,
          meal_name:      meal.name,
          pantry_item_id: ing.pantry_item_id,
          quantity_csilla: ing.quantity_csilla,
          unit:           ing.unit,
        });
      }
    }
  }

  // Active pantry snapshot (non-used items only)
  const pantrySnapshot = _pantry
    .filter(i => !i.used)
    .map(i => ({
      id:                  i.id,
      name:                i.name,
      category:            i.category,
      subcategory:         i.subcategory,
      perishability_level: i.perishability_level,
      partial_remaining:   i.partial_remaining ?? 100,
      expiry_date:         i.expiry_date,
      tags:                i.tags,
    }));

  const todayStr     = today();
  const nextNextSat  = new Date(_nextSaturday + 'T00:00:00');
  nextNextSat.setDate(nextNextSat.getDate() + 7);
  const nextNextSatIso = nextNextSat.toISOString().slice(0, 10);

  return `You're helping Ralph & Csilla plan their next 2 Saturday grocery shops.
Goal: variety + longevity-focused eating (30+ distinct plants/week,
omega-3 sources, cruciferous/leafy/legume rotation, minimal ultra-
processed).

TODAY: ${todayStr}
THIS SATURDAY: ${_thisSaturday}
NEXT SATURDAY: ${_nextSaturday}

CURRENT PANTRY:
${JSON.stringify(pantrySnapshot, null, 2)}

ACTIVE PLAN'S PLANNED CONSUMPTION:
${JSON.stringify(plannedConsumption, null, 2)}

PANTRY STATE AFTER THIS WEEK'S PLAN (computed):
${JSON.stringify(pantryAfterPlan, null, 2)}

LAST 4 WEEKS OF COOKED MEALS:
${JSON.stringify(recentCooked, null, 2)}

PLANT DIVERSITY THIS WEEK (cooked so far):
- distinct plant count: ${diversity.count}
- represented categories: ${diversity.categories.join(', ') || 'none yet'}
- underrepresented (vs target ≥ 30/week): ${diversity.underrepresented.join(', ') || 'none — great!'}

PROFILES:
- Ralph: 30y 180cm 85kg · 2300 kcal · 140g protein/day
- Csilla: 29y 156cm 56kg · 1750 kcal · 95g protein/day

For each item you recommend, decide:
- buy_by_saturday: '${_thisSaturday}' (need it for early next week),
  '${_nextSaturday}' (push it — would perish if bought now), or
  '${nextNextSatIso}' (stable items, no urgency).
- qty: a sensible amount matching how the pantry tracks similar items.
- category: pick from existing pantry categories.
- reason: ≤ 12 words explaining why this item now (not 5 days ago, not
  next month).

Anchor reasoning to perishability. Don't recommend buying critical-
perishability items more than 3 days before they're needed. Don't
duplicate ingredients already covered by this week's plan.

Then write the result to the database via Supabase MCP
(project: uonfyoyzdmzuqremlqgs):

  UPDATE shopping_predictions SET is_active = FALSE WHERE is_active = TRUE;
  INSERT INTO shopping_predictions
    (name, qty, category, buy_by_saturday, reason, source, generated_by)
  VALUES
    (...) -- one row per recommended item, source = 'predicted',
          -- generated_by = 'claude-opus-4-6';

Reply in chat with: total count, the 3 highest-leverage picks, and any
diversity gaps you couldn't fill in 2 weeks.`;
}

// ─── Pantry-state-after-plan simulation ──────────────────────
function computePantryAfterPlan() {
  // Clone relevant state for simulation (keep original _pantryById untouched)
  const state = {};
  for (const item of _pantry) {
    state[item.id] = {
      ...item,
      partial_remaining: item.partial_remaining ?? 100,
      used:              !!item.used,
    };
  }

  for (const day of _days) {
    for (const meal of (day.meals || [])) {
      if (meal.cooked) continue; // already happened — don't double-count
      for (const ing of (meal.ingredients || [])) {
        if (!ing.pantry_item_id || ing.is_pantry_staple) continue;
        const s = state[ing.pantry_item_id];
        if (!s || s.used) continue;

        const pct = getDefaultRemaining(ing, s);
        if (pct === -1) continue;
        if (pct === 0) {
          s.used = true;
          s.partial_remaining = 0;
        } else {
          s.partial_remaining = Math.min(s.partial_remaining, pct);
        }
      }
    }
  }

  return Object.values(state).map(s => ({
    id:                    s.id,
    name:                  s.name,
    category:              s.category,
    estimated_remaining_pct: s.used ? 0 : s.partial_remaining,
  }));
}

// ─── Plant diversity (heuristic) ─────────────────────────────
// NOTE: Uses category-based heuristic (Produce/Legumes/Grains = plants).
// A canonical plant list should be confirmed with Ralph — flagged in commit.
function computePlantDiversity() {
  const PLANT_CATS = new Set(['Produce', 'Legumes', 'Grains']);
  const PLANT_SUBS = new Set([
    'Leafy Greens', 'Cruciferous', 'Root Vegetables', 'Alliums',
    'Mushrooms', 'Salad', 'Herbs', 'Fruit', 'Berries',
    'Legumes', 'Whole Grains', 'Seeds', 'Nuts', 'Sprouts',
  ]);
  const TARGET_SUBS = [
    'Leafy Greens', 'Cruciferous', 'Root Vegetables',
    'Alliums', 'Mushrooms', 'Legumes', 'Whole Grains',
  ];

  const plantNames = new Set();
  const repCats    = new Set();

  for (const day of _days) {
    for (const meal of (day.meals || [])) {
      if (!meal.cooked) continue;
      for (const ing of (meal.ingredients || [])) {
        if (!ing.pantry_item_id) continue;
        const item = _pantryById[ing.pantry_item_id];
        if (!item) continue;
        if (PLANT_CATS.has(item.category) || PLANT_SUBS.has(item.subcategory)) {
          plantNames.add(item.name);
          if (item.category)    repCats.add(item.category);
          if (item.subcategory) repCats.add(item.subcategory);
        }
      }
    }
  }

  return {
    count:           plantNames.size,
    categories:      [...repCats].sort(),
    underrepresented: TARGET_SUBS.filter(s => !repCats.has(s)),
  };
}

// ─── Confirm / prompt modal ───────────────────────────────────
function showConfirmModal(title, body, buttons) {
  if (!document.getElementById('shopConfirmOverlay')) {
    const el = document.createElement('div');
    el.id        = 'shopConfirmOverlay';
    el.className = 'item-modal-overlay'; // reuse overlay CSS
    document.body.appendChild(el);
  }
  const overlay = document.getElementById('shopConfirmOverlay');

  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>${escHtml(title)}</h3>
      <p>${escHtml(body).replace(/\n/g, '<br>')}</p>
      <div class="confirm-modal-btns">
        ${buttons.map(b => `
          <button class="footer-btn ${b.primary ? 'save' : 'cancel'}"
                  data-action="${b.action}">${escHtml(b.label)}</button>
        `).join('')}
      </div>
    </div>`;

  overlay.classList.add('open');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeConfirmModal();
  }, { once: true });
}

function showPromptFallback(prompt) {
  showConfirmModal(
    '🔮 Clipboard blocked',
    'Copy the prompt below and paste it into Cowork-Opus.',
    [{ label: 'Close', action: 'close-confirm' }]
  );
  // Append textarea inside the modal
  const modal = document.querySelector('#shopConfirmOverlay .confirm-modal');
  if (modal) {
    const ta = document.createElement('textarea');
    ta.value    = prompt;
    ta.rows     = 8;
    ta.style.cssText = 'width:100%;font-size:0.78rem;margin-bottom:12px;border:1.5px solid var(--border);border-radius:8px;padding:8px;resize:vertical;';
    modal.insertBefore(ta, modal.querySelector('.confirm-modal-btns'));
    ta.focus(); ta.select();
  }
}

function closeConfirmModal() {
  const overlay = document.getElementById('shopConfirmOverlay');
  if (overlay) overlay.classList.remove('open');
}

// ─── Helpers ─────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }

function addDays(isoStr, n) {
  const d = new Date(isoStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatSaturday(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Guess perishability level from category when level is unknown
function guessPLevel(category) {
  const map = { Produce: 'high', Dairy: 'high', Protein: 'high', Grains: 'stable', Legumes: 'stable', Pantry: 'stable' };
  return map[category] || 'medium';
}

// Parse qty number from a string like "500g" → "500"
function parseQty(qtyStr) {
  if (!qtyStr) return null;
  const m = /^([\d.~]+)\s*[a-zA-Z]*/.exec(qtyStr.trim());
  return m ? m[1] : qtyStr;
}

// Parse unit from a string like "500g" → "g"
function parseUnit(qtyStr) {
  if (!qtyStr) return null;
  const m = /^[\d.~]+\s*([a-zA-Z]+)/.exec(qtyStr.trim());
  return m ? m[1] : null;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
