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
