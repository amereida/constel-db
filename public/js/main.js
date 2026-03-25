// main.js — punto de entrada de con§tel-db
// Conecta auth, state, router, tabs y componentes.

import { state, loadState, subscribe, getStats, notify } from "./state.js";
import { initApi, getCurrentUser, auth } from "./api.js";
import { initRouter, onTabChange } from "./router.js";
import { initSplitViews } from "./components/split-view.js";
import { initSourcesTab, onSourcesActivated } from "./tabs/sources.js";
import { initReaderTab, onReaderActivated } from "./tabs/reader.js";
import { initThemesTab, onThemesActivated } from "./tabs/themes.js";
import { injectEscuelaTab, initEscuelaTab, onEscuelaActivated } from "./tabs/escuela.js";
import { applyTranslations, t } from "./i18n.js";

// ── Arranque ────────────────────────────────────────────────────────────────

async function boot() {
  applyTranslations();
  showStatus(t("reader.loading"));

  // 1. Init Netlify Identity
  await initIdentity();

  // 2. Check auth — require login (skip on localhost for dev)
  const user = getCurrentUser();
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (!user && !isDev) {
    showLoginScreen();
    return;
  }

  // 3. Sync user to DB
  // In dev mode without Identity, backend uses DEV_USER_* env vars as fallback
  if (user || isDev) {
    try {
      const dbUser = await auth.sync();
      if (dbUser) state.currentUser = dbUser;
    } catch (err) {
      console.warn("Auth sync failed:", err);
    }
  }

  // 4. Show user info in header
  if (user) {
    showUserInfo(user);
  } else if (isDev) {
    showStatus("⚡ Modo desarrollo — sin autenticación");
  }

  // 5. Load state from API
  await loadState();

  // 6. Initialize UI
  initSplitViews();
  await initSourcesTab();
  initReaderTab();
  initThemesTab();

  onTabChange("sources", onSourcesActivated);
  onTabChange("reader", onReaderActivated);
  onTabChange("themes", onThemesActivated);

  // Admin-only: Escuela tab
  if (state.currentUser?.role === "admin") {
    injectEscuelaTab();
    initEscuelaTab();
    onTabChange("escuela", onEscuelaActivated);
  }

  initRouter();
  initThemeToggle();

  // 7. Subscribe to status updates
  subscribe(() => {
    const s = getStats();
    showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos`);
  });

  const s = getStats();
  showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos`);

  // 8. Version
  try {
    const vf = await fetch("version.json").then(r => r.ok ? r.json() : null).catch(() => null);
    if (vf?.version) {
      const v = document.getElementById("appVersion");
      if (v) v.textContent = "v" + vf.version;
    }
  } catch {}

  console.log("con§tel-db iniciado");
}

// ── Netlify Identity ────────────────────────────────────────────────────────

function initIdentity() {
  return new Promise((resolve) => {
    function setup(identity) {
      identity.init();
      initApi(identity);

      identity.on("login", async () => {
        identity.close();
        location.reload();
      });

      identity.on("logout", () => {
        location.reload();
      });

      resolve();
    }

    if (window.netlifyIdentity) {
      setup(window.netlifyIdentity);
    } else {
      // Widget script hasn't loaded yet — poll until it does
      const check = setInterval(() => {
        if (window.netlifyIdentity) {
          clearInterval(check);
          setup(window.netlifyIdentity);
        }
      }, 100);
      // Give up after 10s
      setTimeout(() => { clearInterval(check); resolve(); }, 10000);
    }
  });
}

function showLoginScreen() {
  const app = document.getElementById("app") || document.body;
  const loginEl = document.createElement("div");
  loginEl.className = "login-screen";
  loginEl.innerHTML = `
    <div class="login-card">
      <h1>con§tel</h1>
      <p>Herramienta colaborativa de análisis temático</p>
      <button class="btn-primary" id="loginBtn">Iniciar sesión con Google</button>
    </div>
  `;
  app.prepend(loginEl);

  // Hide the main UI until logged in
  document.querySelector(".shell-header")?.style.setProperty("display", "none");
  document.querySelector(".tabs-bar")?.style.setProperty("display", "none");
  document.querySelector(".tab-panels")?.style.setProperty("display", "none");

  loginEl.querySelector("#loginBtn")?.addEventListener("click", () => {
    if (window.netlifyIdentity) {
      window.netlifyIdentity.open("login");
    }
  });
}

function showUserInfo(user) {
  const container = document.getElementById("userInfo");
  if (!container) return;
  const meta = user.user_metadata || {};
  const name = meta.full_name || user.email;
  const avatar = meta.avatar_url;

  container.innerHTML = `
    ${avatar ? `<img src="${avatar}" alt="" class="user-avatar" />` : ""}
    <span class="user-name">${name}</span>
    <button class="btn-icon btn-logout" id="logoutBtn" title="Cerrar sesión">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
    </button>
  `;
  container.style.display = "flex";

  container.querySelector("#logoutBtn")?.addEventListener("click", () => {
    if (window.netlifyIdentity) {
      window.netlifyIdentity.logout();
    }
  });
}

// ── Theme toggle ────────────────────────────────────────────────────────────

function initThemeToggle() {
  const btn = document.getElementById("themeToggle");
  const html = document.documentElement;

  const saved = localStorage.getItem("constel-theme");
  if (saved) html.dataset.theme = saved;
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.dataset.theme = "dark";
  }

  btn?.addEventListener("click", () => {
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    localStorage.setItem("constel-theme", next);
  });
}

// ── Status ──────────────────────────────────────────────────────────────────

function showStatus(msg) {
  const el = document.getElementById("statusMsg");
  if (el) el.textContent = msg;
}

// ── Go ──────────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error("Error al iniciar con§tel-db:", err);
  showStatus("Error al iniciar");
});
