// ─── Shared UI utilities ───────────────────────────────────

export function formatDate(d = new Date()) {
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function daysUntil(dateStr) {
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - n) / 86400000);
}

export function daysLabel(d) {
  if (d < 0)   return 'EXPIRED';
  if (d === 0) return 'TODAY';
  if (d === 1) return '1 day left';
  return `${d} days left`;
}

export function catEmoji(c) {
  return { Protein: '🥩', Produce: '🥦', Dairy: '🥛', Grains: '🌾', Legumes: '🫘', Pantry: '🫙' }[c] || '🍴';
}

export function levelLabel(l) {
  return { critical: '🔴 Critical', high: '🟠 High', medium: '🔵 Medium', low: '🟢 Low', stable: '⚪ Stable' }[l] || l;
}

// ─── Saturday date helpers ────────────────────────────────
// Returns the ISO date string for the next (or current) Saturday.
// inclusive=true: returns today if today IS Saturday.
export function nextSaturday(fromDate = new Date(), inclusive = true) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                   // 0=Sun … 6=Sat
  const isAlreadySat = dow === 6;
  const daysToAdd    = isAlreadySat ? (inclusive ? 0 : 7) : (6 - dow);
  d.setDate(d.getDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

// Returns how many days after today to set expiry, given a perishability level.
// Falls back by category if level is unknown.
export function perishabilityExpiryDays(level, category) {
  const byLevel = { critical: 2, high: 5, medium: 14, low: 30, stable: 180 };
  if (level && byLevel[level] !== undefined) return byLevel[level];
  const byCat   = { Produce: 5, Dairy: 7, Protein: 3, Grains: 180, Legumes: 180, Pantry: 180 };
  return byCat[category] ?? 14;
}

// ─── Smart default: % remaining after one cook use ────────
// Mirrors the logic in mealplan.js confirmCooked.
// Returns: -1 = skip (don't deduct), 0 = all gone, 25|50|75 = % remaining.
// Extracted here so both mealplan.js and shop.js can share it.
export function getDefaultRemaining(ing, item) {
  if (!item) return -1;

  if (ing.urgent) return 0;

  const amt = [ing.quantity_csilla, ing.unit].filter(Boolean).join(' ').toLowerCase();
  if (/\b(full|all remaining|all of it|last|entire)\b/.test(amt)) return 0;

  if (item.perishability_level === 'critical') return 0;

  const skipSubs = new Set(['Oils', 'Spices', 'Baking', 'Seeds', 'Cooking Liquids']);
  if (item.perishability_level === 'stable' && skipSubs.has(item.subcategory)) return -1;

  if (item.subcategory === 'Alliums' && !/\bbunch\b/.test(amt)) return -1;

  if (/^1\s+(whole|eggplant|melon|pineapple)\b/i.test(amt)) return 0;

  if (item.storage_location === 'freezer' && /\b(full|1 pack|1 fish|thawed)\b/.test(amt)) return 0;

  return 75;
}

export function flashSaved() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = '✓ Saved';
  el.className = 'save-indicator saved';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => {
    el.textContent = '';
    el.className = 'save-indicator';
  }, 2000);
}
