// ─── App Bootstrap ────────────────────────────────────────
import { getSession }                          from './supabase.js';
import { renderLoginScreen, renderUserPill,
         bindAuthButtons, onAuthChange }       from './auth.js';
import { loadAndRenderPantry }                 from './pantry.js';
import { loadAndRenderPlan }                   from './mealplan.js';

// Track which tabs have been loaded so we don't re-fetch on every click
const _loaded = { pantry: false, plan: false };

// ─── Entry point ──────────────────────────────────────────
(async function init() {
  const session = await getSession();

  if (!session) {
    showLoginScreen();
    return;
  }

  showApp(session.user);

  // Listen for sign-out / session changes
  onAuthChange(s => {
    if (!s) {
      // Signed out — reload to clean state
      window.location.reload();
    }
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
      <span class="app-logo">🥗</span>
      <span class="app-title">Meal Prep Hub</span>
      ${renderUserPill(user)}
    </header>

    <nav class="tab-nav">
      <button class="tab-btn active" data-tab="pantry">🧊 Pantry</button>
      <button class="tab-btn"        data-tab="plan">📅 Meal Plan</button>
    </nav>

    <section id="tab-pantry" class="tab-content active">
      <div id="urgencyBanner" class="urgency-banner" style="display:none"></div>
      <div id="pantryStats"   class="pantry-stats"></div>
      <div id="pantryGrid"    class="pantry-grid">
        <p class="loading-state">Loading pantry…</p>
      </div>
    </section>

    <section id="tab-plan" class="tab-content">
      <div id="mealPlanContent" class="plan-content">
        <p class="loading-state">Loading meal plan…</p>
      </div>
    </section>
  `;

  // Bind sign-out (rendered inside user pill)
  bindAuthButtons();

  // Bind tab switching
  app.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Load the default tab
  loadTab('pantry');
}

// ─── Tab switching ────────────────────────────────────────
function switchTab(name) {
  // Update button states
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });

  // Show/hide content sections
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
    const el = name === 'pantry'
      ? document.getElementById('pantryGrid')
      : document.getElementById('mealPlanContent');
    if (el) el.innerHTML = `<p class="error-state">⚠️ Failed to load — ${err.message}</p>`;
    // Allow retry on next click
    _loaded[name] = false;
  }
}
