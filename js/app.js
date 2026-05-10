// ─── App Bootstrap ────────────────────────────────────────
import { getSession }                          from './supabase.js';
import { renderLoginScreen, renderUserPill,
         bindAuthButtons, onAuthChange }       from './auth.js';
import { loadAndRenderPantry }                 from './pantry.js';
import { loadAndRenderPlan }                   from './mealplan.js';
import { formatDate }                          from './ui.js';

const _loaded = { pantry: false, plan: false };

// ─── Entry point ──────────────────────────────────────────
(async function init() {
  const session = await getSession();

  if (!session) {
    showLoginScreen();
    return;
  }

  showApp(session.user);

  onAuthChange(s => {
    if (!s) window.location.reload();
  });
})();

// ─── Login screen ─────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('app').innerHTML = renderLoginScreen();
  bindAuthButtons();
}

// ─── Authenticated app shell ───────────────────────────────
function showApp(user) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <header class="app-header">
      <div>
        <div class="header-title">🥗 Meal Prep Hub</div>
        <div class="header-tagline">Ralph &amp; Csilla · Healthy Eating for Energy &amp; Longevity</div>
      </div>
      <div class="header-right">
        <div class="date-badge">${formatDate()}</div>
        <div class="header-actions">
          <span class="save-indicator" id="saveIndicator"></span>
          ${renderUserPill(user)}
        </div>
      </div>
    </header>

    <nav class="tab-nav">
      <button class="tab-btn active" data-tab="pantry">🧺 Pantry</button>
      <button class="tab-btn"        data-tab="plan">🍽️ Meal Plan</button>
    </nav>

    <section id="tab-pantry" class="tab-content active"></section>
    <section id="tab-plan"   class="tab-content"></section>
  `;

  bindAuthButtons();

  app.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  loadTab('pantry');
}

// ─── Tab switching ────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${name}`);
  });
  loadTab(name);
}

// ─── Lazy tab loader ──────────────────────────────────────
async function loadTab(name) {
  if (_loaded[name]) return;
  _loaded[name] = true;

  try {
    if (name === 'pantry') {
      await loadAndRenderPantry();
    } else if (name === 'plan') {
      await loadAndRenderPlan();
    }
  } catch (err) {
    console.error(`Failed to load tab "${name}":`, err);
    const el = document.getElementById(`tab-${name}`);
    if (el) el.innerHTML = `<p class="error-state">⚠️ Failed to load — ${err.message}</p>`;
    _loaded[name] = false;
  }
}
