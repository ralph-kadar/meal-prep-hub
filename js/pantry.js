// ─── Pantry Module ────────────────────────────────────────
import { fetchPantry, updatePantryItem } from './supabase.js';

let _items = [];

const PERISHABILITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, stable: 4 };
const PERISHABILITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', stable: '⚪' };

// ─── Load & render ────────────────────────────────────────
export async function loadAndRenderPantry() {
  _items = await fetchPantry();
  renderPantry();
}

function renderPantry() {
  renderUrgencyBanner();
  renderStats();
  renderGrid();
}

// ─── Urgency banner ───────────────────────────────────────
function renderUrgencyBanner() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const urgent = _items.filter(item => {
    if (item.used) return false;
    if (!item.expiry_date) return false;
    const exp = new Date(item.expiry_date);
    const diffDays = Math.ceil((exp - today) / 86400000);
    return diffDays <= 2 && (item.perishability_level === 'critical' || item.perishability_level === 'high');
  });

  const banner = document.getElementById('urgencyBanner');
  if (!banner) return;

  if (urgent.length === 0) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = '';
  banner.innerHTML = `
    <span class="banner-icon">⚠️</span>
    <strong>Use today:</strong>
    ${urgent.map(i => `<span class="urgent-chip">${i.name}</span>`).join('')}
  `;
}

// ─── Stats bar ────────────────────────────────────────────
function renderStats() {
  const total    = _items.length;
  const used     = _items.filter(i => i.used).length;
  const partial  = _items.filter(i => !i.used && i.partial_remaining !== null).length;
  const active   = total - used;

  const el = document.getElementById('pantryStats');
  if (!el) return;
  el.innerHTML = `
    <span>📦 <strong>${active}</strong> active</span>
    <span>✅ <strong>${used}</strong> used</span>
    <span>🔶 <strong>${partial}</strong> partial</span>
  `;
}

// ─── Item grid ────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('pantryGrid');
  if (!grid) return;

  // Sort: used items last, then by perishability, then expiry date
  const sorted = [..._items].sort((a, b) => {
    if (a.used !== b.used) return a.used ? 1 : -1;
    const pa = PERISHABILITY_ORDER[a.perishability_level] ?? 5;
    const pb = PERISHABILITY_ORDER[b.perishability_level] ?? 5;
    if (pa !== pb) return pa - pb;
    return (a.expiry_date || '9999') < (b.expiry_date || '9999') ? -1 : 1;
  });

  grid.innerHTML = sorted.map(item => renderItemCard(item)).join('');

  // Bind toggle events
  grid.querySelectorAll('[data-item-id]').forEach(card => {
    const id = card.dataset.itemId;
    card.querySelector('.btn-used')?.addEventListener('click', () => toggleUsed(id));
    card.querySelector('.partial-slider')?.addEventListener('input', e => {
      updatePartial(id, parseInt(e.target.value));
    });
  });
}

function renderItemCard(item) {
  const emoji   = PERISHABILITY_EMOJI[item.perishability_level] || '⚪';
  const usedCls = item.used ? 'card--used' : '';
  const partial = item.partial_remaining;
  const hasPartial = partial !== null && !item.used;

  return `
    <div class="item-card ${usedCls}" data-item-id="${item.id}">
      <div class="card-header">
        <span class="perishability-dot">${emoji}</span>
        <span class="card-name">${item.name}</span>
        <button class="btn-used" title="${item.used ? 'Mark available' : 'Mark used'}">
          ${item.used ? '↩' : '✓'}
        </button>
      </div>
      <div class="card-meta">
        <span>${item.category || ''}${item.subcategory ? ' · ' + item.subcategory : ''}</span>
        <span>${item.quantity || ''} ${item.unit || ''}</span>
      </div>
      <div class="card-footer">
        <span class="storage-badge">${item.storage_location || ''}</span>
        ${item.expiry_date ? `<span class="expiry-badge">${expiryLabel(item.expiry_date)}</span>` : ''}
      </div>
      ${hasPartial ? `
        <div class="partial-row">
          <label>Remaining: <strong>${partial}%</strong></label>
          <input type="range" class="partial-slider" min="0" max="100" step="25" value="${partial}">
        </div>` : ''}
    </div>
  `;
}

function expiryLabel(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(dateStr);
  const diff  = Math.ceil((exp - today) / 86400000);
  if (diff < 0)  return `<span class="exp-overdue">Expired</span>`;
  if (diff === 0) return `<span class="exp-today">Expires today</span>`;
  if (diff === 1) return `<span class="exp-soon">Tomorrow</span>`;
  if (diff <= 3)  return `<span class="exp-soon">In ${diff} days</span>`;
  return `<span class="exp-ok">${exp.toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</span>`;
}

// ─── Mutations ────────────────────────────────────────────
async function toggleUsed(id) {
  const item = _items.find(i => i.id === id);
  if (!item) return;
  const newUsed = !item.used;
  item.used      = newUsed;
  item.used_date = newUsed ? new Date().toISOString().slice(0, 10) : null;
  renderPantry();
  await updatePantryItem(id, { used: newUsed, used_date: item.used_date });
}

async function updatePartial(id, value) {
  const item = _items.find(i => i.id === id);
  if (!item) return;
  item.partial_remaining = value;
  // Re-render the single card's label without full grid re-render
  const card = document.querySelector(`[data-item-id="${id}"] .partial-row label`);
  if (card) card.innerHTML = `Remaining: <strong>${value}%</strong>`;
  await updatePantryItem(id, { partial_remaining: value });
}
