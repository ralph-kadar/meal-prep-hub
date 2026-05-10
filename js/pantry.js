// ─── Pantry Module ────────────────────────────────────────
import { fetchPantry, updatePantryItem } from './supabase.js';
import { daysUntil, daysLabel, catEmoji, levelLabel, flashSaved } from './ui.js';

let _items         = [];
let _openPartialId = null;
let _pendingPct    = null;

const LS_KEY = 'mealprep-pantry-filters';

let _filters = {
  search:      '',
  category:    'all',
  location:    'all',
  sort:        'expiry',
  perishFilter: 'all',
  showUsed:    false,
  ...JSON.parse(localStorage.getItem(LS_KEY) || '{}')
};

function saveFilters() {
  localStorage.setItem(LS_KEY, JSON.stringify(_filters));
}

// ─── Entry point ──────────────────────────────────────────
export async function loadAndRenderPantry() {
  const container = document.getElementById('tab-pantry');
  container.innerHTML = `<p class="loading-state">Loading pantry…</p>`;
  _items = await fetchPantry();
  renderShell();
  bindEvents();
  renderAll();
}

// ─── Render the structural shell (controls + legend + grid container) ──
function renderShell() {
  const categories = [...new Set(_items.map(i => i.category).filter(Boolean))].sort();
  const locations  = [...new Set(_items.map(i => (i.storage_location || '').toLowerCase()).filter(Boolean))].sort();

  const catOptions = ['all', ...categories]
    .map(c => `<option value="${c}" ${_filters.category === c ? 'selected' : ''}>${c === 'all' ? 'All categories' : c}</option>`)
    .join('');

  const locOptions = ['all', ...locations]
    .map(l => `<option value="${l}" ${_filters.location === l ? 'selected' : ''}>${l === 'all' ? 'All locations' : l}</option>`)
    .join('');

  const perishLevels = [
    { val: 'all',      label: 'All' },
    { val: 'critical', label: '🔴 Critical', col: '#c0392b' },
    { val: 'high',     label: '🟠 High',     col: '#e67e22' },
    { val: 'medium',   label: '🔵 Medium',   col: '#2980b9' },
    { val: 'stable',   label: '⚪ Stable',   col: '#555' },
  ];

  document.getElementById('tab-pantry').innerHTML = `
    <div class="urgency-banner" id="urgencyBanner" style="display:none">
      <span>🚨</span><span id="urgencyText"></span>
    </div>

    <div class="stats-bar" id="statsBar">
      <div class="stat-card critical"><div class="num" id="statToday">—</div><div class="lbl">Use today</div></div>
      <div class="stat-card high">   <div class="num" id="statWeek">—</div> <div class="lbl">This week</div></div>
      <div class="stat-card">        <div class="num" id="statTotal">—</div><div class="lbl">Active items</div></div>
      <div class="stat-card partial"><div class="num" id="statPartial">—</div><div class="lbl">Partial use</div></div>
      <div class="stat-card used-s"> <div class="num" id="statUsed">—</div> <div class="lbl">Used up</div></div>
    </div>

    <div class="controls">
      <input id="searchInput" class="search-input"
             placeholder="🔍  Search ingredients…"
             value="${escHtml(_filters.search)}" />
      <select id="categoryFilter" class="filter-select">${catOptions}</select>
      <select id="locationFilter" class="filter-select">${locOptions}</select>
      <select id="sortOrder" class="filter-select">
        <option value="expiry"    ${_filters.sort === 'expiry'    ? 'selected' : ''}>Sort: expires soonest</option>
        <option value="name"      ${_filters.sort === 'name'      ? 'selected' : ''}>Sort: name A–Z</option>
        <option value="category"  ${_filters.sort === 'category'  ? 'selected' : ''}>Sort: category</option>
      </select>
      ${perishLevels.map(p => `
        <button class="filter-btn ${_filters.perishFilter === p.val ? 'active' : ''}"
                data-perish="${p.val}"
                ${p.col ? `style="color:${p.col}"` : ''}>
          ${p.label}
        </button>`).join('')}
      <label class="show-used-toggle">
        <input type="checkbox" id="showUsed" ${_filters.showUsed ? 'checked' : ''} /> Show used items
      </label>
    </div>

    <div class="legend">
      <strong>Perishability:</strong>
      <div class="legend-item"><div class="legend-dot" style="background:#c0392b"></div> Critical (1–2 days)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#e67e22"></div> High (3–7 days)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#2980b9"></div> Medium (1–3 weeks)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#27ae60"></div> Low (1 month)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#95a5a6"></div> Stable (pantry/frozen)</div>
    </div>

    <div class="grid" id="itemGrid"></div>
  `;
}

// ─── Bind event delegation once ───────────────────────────
function bindEvents() {
  const tab = document.getElementById('tab-pantry');

  // filter chip clicks
  tab.addEventListener('click', e => {
    const perishBtn = e.target.closest('[data-perish]');
    if (perishBtn) {
      _filters.perishFilter = perishBtn.dataset.perish;
      tab.querySelectorAll('[data-perish]').forEach(b =>
        b.classList.toggle('active', b.dataset.perish === _filters.perishFilter)
      );
      saveFilters();
      renderGrid();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    const id     = e.target.closest('[data-id]')?.dataset.id;
    if (!action) return;

    if (action === 'toggle-used')    toggleUsed(id);
    if (action === 'toggle-partial') togglePartialPanel(id);
    if (action === 'save-partial')   savePartial(id);
    if (action === 'select-pct') {
      const pct = parseInt(e.target.closest('[data-pct]').dataset.pct);
      selectPct(id, pct);
    }
  });

  // filter inputs
  tab.addEventListener('input', e => {
    if (e.target.id === 'searchInput') {
      _filters.search = e.target.value;
      saveFilters();
      renderGrid();
    }
    if (e.target.classList.contains('partial-slider')) {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id) sliderChange(id, e.target.value);
    }
  });

  tab.addEventListener('change', e => {
    if (e.target.id === 'categoryFilter') { _filters.category = e.target.value; saveFilters(); renderGrid(); }
    if (e.target.id === 'locationFilter') { _filters.location = e.target.value; saveFilters(); renderGrid(); }
    if (e.target.id === 'sortOrder')      { _filters.sort     = e.target.value; saveFilters(); renderGrid(); }
    if (e.target.id === 'showUsed')       { _filters.showUsed = e.target.checked; saveFilters(); renderGrid(); renderStats(); }
  });
}

// ─── Render all dynamic sections ─────────────────────────
function renderAll() {
  renderUrgencyBanner();
  renderStats();
  renderGrid();
}

// ─── Urgency banner ───────────────────────────────────────
function renderUrgencyBanner() {
  const urgent = _items.filter(i => {
    if (i.used) return false;
    if (!i.expiry_date) return false;
    return daysUntil(i.expiry_date) <= 1;
  });

  const banner = document.getElementById('urgencyBanner');
  if (!banner) return;

  if (!urgent.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  document.getElementById('urgencyText').textContent =
    `Use today: ${urgent.map(i => i.name).join(', ')}`;
}

// ─── Stats bar ────────────────────────────────────────────
function renderStats() {
  const active  = _items.filter(i => !i.used);
  const usedAll = _items.filter(i => i.used);
  const partial = active.filter(i => i.partial_remaining !== null && i.partial_remaining !== undefined);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statToday',   active.filter(i => i.expiry_date && daysUntil(i.expiry_date) <= 2).length);
  set('statWeek',    active.filter(i => { const d = i.expiry_date ? daysUntil(i.expiry_date) : 99; return d > 2 && d <= 7; }).length);
  set('statTotal',   active.length);
  set('statPartial', partial.length);
  set('statUsed',    usedAll.length);
}

// ─── Item grid ────────────────────────────────────────────
function renderGrid() {
  const { search, category, location, sort, perishFilter, showUsed } = _filters;
  const q = search.toLowerCase();

  let items = _items.filter(item => {
    if (item.used && !showUsed) return false;
    if (category !== 'all' && item.category !== category) return false;
    if (location !== 'all' && !(item.storage_location || '').toLowerCase().includes(location)) return false;
    if (perishFilter !== 'all' && item.perishability_level !== perishFilter) return false;
    if (q) {
      const haystack = [item.name, item.name_ro, item.subcategory,
                        (item.tags || []).join(' '), item.notes].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (sort === 'expiry')   items.sort((a, b) => (a.expiry_date || '9999') < (b.expiry_date || '9999') ? -1 : 1);
  else if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
  else                      items.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));

  const grid = document.getElementById('itemGrid');
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = '<div class="no-results">No items match your filters.</div>';
    return;
  }

  grid.innerHTML = items.map(item => renderItemCard(item)).join('');
  renderUrgencyBanner();
  renderStats();
}

// ─── Item card ────────────────────────────────────────────
function renderItemCard(item) {
  const isUsed    = !!item.used;
  const remaining = isUsed ? 0 : (item.partial_remaining ?? 100);
  const lvl       = item.perishability_level || 'stable';
  const days      = item.expiry_date ? daysUntil(item.expiry_date) : null;
  const isPanelOpen = _openPartialId === item.id;
  const barCls    = remaining > 50 ? '' : remaining > 20 ? ' warn' : ' danger';

  const barHTML = isUsed ? '' : `
    <div class="usage-bar"><div class="usage-bar-fill${barCls}" style="width:${remaining}%"></div></div>
    <div class="usage-label">${remaining === 100 ? 'Full stock' : remaining === 0 ? 'All gone' : remaining + '% remaining'}${item.updated_at ? ' · updated ' + item.updated_at.slice(0, 10) : ''}</div>`;

  let buttonsHTML;
  if (isUsed) {
    buttonsHTML = `
      <button class="action-btn undo" data-action="toggle-used" data-id="${item.id}">
        ↩ Restore (used ${item.used_date || ''})
      </button>`;
  } else {
    buttonsHTML = `
      <div class="btn-row">
        <button class="action-btn partial" data-action="toggle-partial" data-id="${item.id}">
          ${isPanelOpen ? '✕ Cancel' : '📊 Log partial use'}
        </button>
        <button class="action-btn full" data-action="toggle-used" data-id="${item.id}">✓ Fully used</button>
      </div>`;
  }

  const curVal = (_pendingPct !== null && isPanelOpen) ? _pendingPct : remaining;
  const panelHTML = isPanelOpen ? `
    <div class="partial-panel" data-id="${item.id}">
      <label>How much is left after this use?</label>
      <div class="partial-quick" id="pq-${item.id}">
        ${[75, 50, 25, 10, 0].map(p => `
          <button data-action="select-pct" data-id="${item.id}" data-pct="${p}"
                  class="${curVal === p ? 'sel' : ''}">
            ${p === 0 ? 'All gone' : p + '% left'}
          </button>`).join('')}
      </div>
      <div class="partial-slider-row">
        <span>Custom:</span>
        <input type="range" class="partial-slider" id="ps-${item.id}"
               min="0" max="100" step="5" value="${curVal}">
        <span class="partial-slider-lbl" id="pl-${item.id}">
          ${curVal === 0 ? 'All gone' : curVal + '% remaining'}
        </span>
      </div>
      <button class="partial-save-btn" data-action="save-partial" data-id="${item.id}">💾 Save</button>
    </div>` : '';

  const daysVal  = days !== null ? days : 999;
  const daysLvl  = daysVal < 0 ? 'expired' : lvl;

  return `
    <div class="item-card ${lvl}${isUsed ? ' used-card' : ''}" data-id="${item.id}">
      <div class="item-header">
        <div>
          <div class="item-name">${catEmoji(item.category)} ${escHtml(item.name)}</div>
          ${item.name_ro ? `<div class="item-name-ro">${escHtml(item.name_ro)}</div>` : ''}
        </div>
      </div>
      <div class="badges">
        <span class="badge ${lvl}">${levelLabel(lvl)}</span>
        ${item.subcategory ? `<span class="badge cat">${escHtml(item.subcategory)}</span>` : ''}
        ${item.storage_location ? `<span class="badge loc">📍 ${escHtml(item.storage_location)}</span>` : ''}
      </div>
      <div class="item-details"><strong>Amount:</strong> ${escHtml(item.quantity || '')}${item.unit ? ' ' + escHtml(item.unit) : ''}</div>
      ${item.notes ? `<div class="item-notes">💡 ${escHtml(item.notes)}</div>` : ''}
      ${days !== null ? `
        <div class="expiry-row">
          <div class="expiry-text">⏰ Expires: <strong>${item.expiry_date}</strong></div>
          <div class="days-left ${daysLvl}">${daysLabel(daysVal)}</div>
        </div>` : ''}
      ${barHTML}
      ${buttonsHTML}
      ${panelHTML}
    </div>`;
}

// ─── Partial panel helpers ────────────────────────────────
function togglePartialPanel(id) {
  if (_openPartialId === id) {
    _openPartialId = null;
    _pendingPct    = null;
  } else {
    _openPartialId = id;
    const item     = _items.find(i => i.id === id);
    _pendingPct    = item?.partial_remaining ?? null;
  }
  renderGrid();
}

function selectPct(id, pct) {
  _pendingPct = pct;
  document.querySelectorAll(`#pq-${id} button`).forEach(b =>
    b.classList.toggle('sel', parseInt(b.dataset.pct) === pct)
  );
  const sl = document.getElementById('ps-' + id);
  const lb = document.getElementById('pl-' + id);
  if (sl) sl.value = pct;
  if (lb) lb.textContent = pct === 0 ? 'All gone' : `${pct}% remaining`;
}

function sliderChange(id, val) {
  _pendingPct = parseInt(val);
  document.querySelectorAll(`#pq-${id} button`).forEach(b =>
    b.classList.toggle('sel', parseInt(b.dataset.pct) === _pendingPct)
  );
  const lb = document.getElementById('pl-' + id);
  if (lb) lb.textContent = _pendingPct === 0 ? 'All gone' : `${_pendingPct}% remaining`;
}

async function savePartial(id) {
  if (_pendingPct === null) return;
  const item = _items.find(i => i.id === id);
  if (!item) return;

  const pct = _pendingPct;
  _openPartialId = null;
  _pendingPct    = null;

  if (pct === 0) {
    item.used      = true;
    item.used_date = today();
    item.partial_remaining = null;
    renderGrid();
    await updatePantryItem(id, { used: true, used_date: item.used_date, partial_remaining: null });
  } else {
    item.partial_remaining = pct;
    renderGrid();
    await updatePantryItem(id, { partial_remaining: pct });
  }
  flashSaved();
}

// ─── Mutations ────────────────────────────────────────────
async function toggleUsed(id) {
  const item = _items.find(i => i.id === id);
  if (!item) return;

  const newUsed  = !item.used;
  item.used      = newUsed;
  item.used_date = newUsed ? today() : null;
  if (newUsed) item.partial_remaining = null;

  renderGrid();
  await updatePantryItem(id, { used: newUsed, used_date: item.used_date });
  flashSaved();
}

// ─── Helpers ──────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
