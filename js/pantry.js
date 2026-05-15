// ─── Pantry Module ────────────────────────────────────────
import { fetchPantry, updatePantryItem, insertPantryItem, deletePantryItem } from './supabase.js';
import { daysUntil, daysLabel, catEmoji, levelLabel, flashSaved } from './ui.js';

let _items         = [];
let _openPartialId = null;
let _pendingPct    = null;
let _editingId     = null;   // null = add mode, string = edit mode

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
  buildModal();   // injects modal into body once; no-op if already present
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

    <div class="add-item-bar">
      <button class="add-item-btn" data-action="add-item">＋ Add item</button>
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

    if (action === 'add-item')       openItemModal(null);
    if (action === 'edit-item')      openItemModal(id);
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
        <button class="edit-btn" data-action="edit-item" data-id="${item.id}"
                aria-label="Edit ${escHtml(item.name)}" title="Edit">✏️</button>
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

// ─── Next sequential text ID ──────────────────────────────
// Finds the max numeric ID in _items and zero-pads the next one.
function nextId() {
  const nums = _items.map(i => parseInt(i.id, 10)).filter(n => Number.isFinite(n));
  return String(Math.max(0, ...nums) + 1).padStart(3, '0');
}

// ─── Add / Edit modal ────────────────────────────────────

function buildModal() {
  if (document.getElementById('itemModalOverlay')) return; // already built

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="itemModalOverlay" class="item-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="itemModalTitle">
      <div class="item-modal">
        <div class="item-modal-header">
          <h3 id="itemModalTitle">Add Item</h3>
          <button class="item-modal-close" id="itemModalClose" aria-label="Close">✕</button>
        </div>
        <div class="item-modal-body">
          <form id="itemForm" class="item-form" novalidate>
            <div class="form-errors" id="formErrors" style="display:none"></div>
            <div class="form-warning" id="formWarning" style="display:none"></div>

            <div class="form-row">
              <label for="f-name">Name <span class="req">*</span></label>
              <input type="text" id="f-name" name="name" required
                     placeholder="e.g. Cherry tomatoes" autocomplete="off">
            </div>

            <div class="form-row">
              <label for="f-name-ro">Romanian name</label>
              <input type="text" id="f-name-ro" name="name_ro"
                     placeholder="e.g. Roșii cherry" autocomplete="off">
            </div>

            <div class="form-grid-2">
              <div class="form-row">
                <label for="f-category">Category</label>
                <input type="text" id="f-category" name="category"
                       list="dl-category" autocomplete="off" placeholder="e.g. Vegetables">
                <datalist id="dl-category"></datalist>
              </div>
              <div class="form-row">
                <label for="f-subcategory">Subcategory</label>
                <input type="text" id="f-subcategory" name="subcategory"
                       autocomplete="off" placeholder="e.g. Salad">
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-row">
                <label for="f-quantity">Quantity</label>
                <input type="text" id="f-quantity" name="quantity"
                       placeholder="e.g. 500 or ~1kg">
              </div>
              <div class="form-row">
                <label for="f-unit">Unit</label>
                <input type="text" id="f-unit" name="unit"
                       placeholder="e.g. g, ml, bunch">
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-row">
                <label for="f-purchase-date">Purchase date</label>
                <input type="date" id="f-purchase-date" name="purchase_date">
              </div>
              <div class="form-row">
                <label for="f-expiry-date">Expiry date <span class="req">*</span></label>
                <input type="date" id="f-expiry-date" name="expiry_date" required>
              </div>
            </div>

            <div class="form-row">
              <label for="f-perish">Perishability</label>
              <select id="f-perish" name="perishability_level">
                <option value="">— select —</option>
                <option value="critical">🔴 Critical (1–2 days)</option>
                <option value="high">🟠 High (3–7 days)</option>
                <option value="medium">🔵 Medium (1–3 weeks)</option>
                <option value="low">🟢 Low (~1 month)</option>
                <option value="stable">⚪ Stable (pantry/frozen)</option>
              </select>
            </div>

            <div class="form-row">
              <label for="f-location">Storage location</label>
              <input type="text" id="f-location" name="storage_location"
                     list="dl-location" autocomplete="off" placeholder="e.g. fridge">
              <datalist id="dl-location"></datalist>
            </div>

            <div class="form-row">
              <label for="f-notes">Notes</label>
              <textarea id="f-notes" name="notes" rows="2"
                        placeholder="Any notes…"></textarea>
            </div>

            <div class="form-row">
              <label for="f-tags">Tags</label>
              <input type="text" id="f-tags" name="tags"
                     placeholder="e.g. protein, bulk-buy" autocomplete="off">
              <div class="form-hint">Comma-separated</div>
            </div>
          </form>
        </div>
        <div class="item-modal-footer">
          <button type="button" class="footer-btn delete" id="itemDeleteBtn" style="display:none">🗑 Delete</button>
          <button type="button" class="footer-btn cancel" id="itemCancelBtn">Cancel</button>
          <button type="submit" form="itemForm" class="footer-btn save" id="itemSaveBtn">Add item</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);

  // Close gestures
  document.getElementById('itemModalClose').addEventListener('click', closeItemModal);
  document.getElementById('itemCancelBtn').addEventListener('click', closeItemModal);
  document.getElementById('itemModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeItemModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('itemModalOverlay').classList.contains('open')) {
      closeItemModal();
    }
  });

  // Delete
  document.getElementById('itemDeleteBtn').addEventListener('click', () => deleteItem(_editingId));

  // Submit
  document.getElementById('itemForm').addEventListener('submit', submitItemForm);

  // Dupe check on blur of name / category / location
  ['f-name', 'f-category', 'f-location'].forEach(id => {
    document.getElementById(id).addEventListener('blur', checkDuplicate);
  });
}

function openItemModal(id = null) {
  _editingId = id;
  populateDataLists();
  const item = id ? _items.find(i => i.id === id) : null;
  populateModal(item);

  document.getElementById('itemModalTitle').textContent = id ? 'Edit Item' : 'Add Item';
  document.getElementById('itemSaveBtn').textContent    = id ? 'Save changes' : 'Add item';
  document.getElementById('itemDeleteBtn').style.display = id ? 'inline-flex' : 'none';

  document.getElementById('itemModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function closeItemModal() {
  document.getElementById('itemModalOverlay').classList.remove('open');
  _editingId = null;
}

function populateDataLists() {
  const cats = [...new Set(_items.map(i => i.category).filter(Boolean))].sort();
  const locs = [...new Set(_items.map(i => i.storage_location).filter(Boolean))].sort();
  document.getElementById('dl-category').innerHTML = cats.map(c => `<option value="${escHtml(c)}">`).join('');
  document.getElementById('dl-location').innerHTML = locs.map(l => `<option value="${escHtml(l)}">`).join('');
}

function populateModal(item) {
  document.getElementById('formErrors').style.display  = 'none';
  document.getElementById('formWarning').style.display = 'none';

  if (!item) {
    document.getElementById('itemForm').reset();
    document.getElementById('f-purchase-date').value = today();
    return;
  }

  document.getElementById('f-name').value          = item.name              || '';
  document.getElementById('f-name-ro').value        = item.name_ro          || '';
  document.getElementById('f-category').value       = item.category         || '';
  document.getElementById('f-subcategory').value    = item.subcategory      || '';
  document.getElementById('f-quantity').value       = item.quantity         || '';
  document.getElementById('f-unit').value           = item.unit             || '';
  document.getElementById('f-purchase-date').value  = item.purchase_date    || '';
  document.getElementById('f-expiry-date').value    = item.expiry_date      || '';
  document.getElementById('f-perish').value         = item.perishability_level || '';
  document.getElementById('f-location').value       = item.storage_location || '';
  document.getElementById('f-notes').value          = item.notes            || '';
  document.getElementById('f-tags').value           = (item.tags || []).join(', ');
}

function readFormData() {
  return {
    name:                document.getElementById('f-name').value.trim(),
    name_ro:             document.getElementById('f-name-ro').value.trim()       || null,
    category:            document.getElementById('f-category').value.trim()      || null,
    subcategory:         document.getElementById('f-subcategory').value.trim()   || null,
    quantity:            document.getElementById('f-quantity').value.trim()      || null,
    unit:                document.getElementById('f-unit').value.trim()          || null,
    purchase_date:       document.getElementById('f-purchase-date').value        || null,
    expiry_date:         document.getElementById('f-expiry-date').value          || null,
    perishability_level: document.getElementById('f-perish').value               || null,
    storage_location:    document.getElementById('f-location').value.trim()      || null,
    notes:               document.getElementById('f-notes').value.trim()         || null,
    tags:                document.getElementById('f-tags').value
                           .split(',').map(t => t.trim()).filter(Boolean),
  };
}

function checkDuplicate() {
  const name = document.getElementById('f-name').value.trim().toLowerCase();
  if (!name) { document.getElementById('formWarning').style.display = 'none'; return; }

  const cat = document.getElementById('f-category').value.trim().toLowerCase();
  const loc = document.getElementById('f-location').value.trim().toLowerCase();

  const dupe = _items.find(i =>
    i.id !== _editingId &&
    !i.used &&
    (i.name || '').toLowerCase() === name &&
    (!cat || (i.category         || '').toLowerCase() === cat) &&
    (!loc || (i.storage_location || '').toLowerCase() === loc)
  );

  const warn = document.getElementById('formWarning');
  if (dupe) {
    warn.textContent = `⚠️ "${dupe.name}" already exists in your pantry (not yet used).`;
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}

async function submitItemForm(e) {
  e.preventDefault();
  const data = readFormData();

  // Validation
  const errors = [];
  if (!data.name)        errors.push('Name is required.');
  if (!data.expiry_date) errors.push('Expiry date is required.');
  if (data.purchase_date && data.expiry_date && data.expiry_date < data.purchase_date) {
    errors.push('Expiry date must be on or after the purchase date.');
  }
  if (errors.length) {
    const el = document.getElementById('formErrors');
    el.textContent = errors.join(' ');
    el.style.display = 'block';
    return;
  }

  const saveBtn = document.getElementById('itemSaveBtn');
  saveBtn.disabled    = true;
  saveBtn.textContent = _editingId ? 'Saving…' : 'Adding…';

  if (_editingId) {
    // ── Edit ─────────────────────────────────────────────
    const idx = _items.findIndex(i => i.id === _editingId);
    const prev = idx !== -1 ? { ..._items[idx] } : null;
    const scrollY = window.scrollY;

    if (idx !== -1) Object.assign(_items[idx], data);
    closeItemModal();
    renderAll();
    requestAnimationFrame(() => window.scrollTo(0, scrollY));

    try {
      await updatePantryItem(_editingId, data);
      flashSaved();
    } catch (err) {
      console.error('Update failed:', err);
      if (idx !== -1 && prev) _items[idx] = prev;
      renderAll();
      alert('Save failed: ' + (err.message || 'Unknown error'));
    }
  } else {
    // ── Add ──────────────────────────────────────────────
    const tempId  = nextId();
    const newItem = { id: tempId, ...data, used: false, created_at: new Date().toISOString() };
    _items.push(newItem);
    closeItemModal();
    renderAll();

    try {
      const inserted = await insertPantryItem({ ...data, id: tempId });
      // Replace temp item with the full DB row (has updated_at etc.)
      const idx = _items.findIndex(i => i.id === tempId);
      if (idx !== -1) _items[idx] = inserted;
      flashSaved();
    } catch (err) {
      console.error('Insert failed:', err);
      _items = _items.filter(i => i.id !== tempId);
      renderAll();
      alert('Add failed: ' + (err.message || 'Unknown error'));
    }
  }

  // Re-enable save button in case modal is re-opened quickly
  saveBtn.disabled    = false;
  saveBtn.textContent = _editingId ? 'Save changes' : 'Add item';
}

async function deleteItem(id) {
  if (!id) return;
  const item = _items.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.name}"?\n\nThis will hide it from the pantry. It can be recovered from the database if needed.`)) return;

  const idx     = _items.findIndex(i => i.id === id);
  const removed = _items.splice(idx, 1)[0];
  closeItemModal();
  renderAll();

  try {
    await deletePantryItem(id);
    flashSaved();
  } catch (err) {
    console.error('Delete failed:', err);
    _items.splice(idx, 0, removed);
    renderAll();
    alert('Delete failed: ' + (err.message || 'Unknown error'));
  }
}
