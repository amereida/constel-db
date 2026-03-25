// main.js — punto de entrada de con§tel-db
// Conecta auth, state, router, tabs y componentes.

import { state, loadState, subscribe, getStats, notify } from "./state.js";
import { initApi, getCurrentUser, requireLogin, auth } from "./api.js";
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

  // 1. Init Netlify Identity + handle OAuth callback
  await initIdentity();
  handleOAuthCallback();

  // 2. Check auth (no longer blocks the app)
  const user = getCurrentUser();
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  // 3. Sync user to DB if logged in
  if (user || isDev) {
    try {
      const dbUser = await auth.sync();
      if (dbUser) state.currentUser = dbUser;
    } catch (err) {
      console.warn("Auth sync failed:", err);
    }
  }

  // 4. Show user info or login button in header
  if (user) {
    showUserInfo(user);
  } else if (isDev) {
    showDevInfo();
  } else {
    showLoginButton();
  }

  // 5. Load state from API (public endpoints work without auth)
  await loadState();

  // 6. Initialize UI — always, regardless of auth
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
      identity.init({
        APIUrl: "https://constel-amereida.netlify.app/.netlify/identity"
      });
      initApi(identity);

      identity.on("login", async () => {
        identity.close();
        location.reload();
      });

      identity.on("logout", () => {
        state.currentUser = null;
        location.reload();
      });

      resolve();
    }

    if (window.netlifyIdentity) {
      setup(window.netlifyIdentity);
    } else {
      const check = setInterval(() => {
        if (window.netlifyIdentity) {
          clearInterval(check);
          setup(window.netlifyIdentity);
        }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 10000);
    }
  });
}

/**
 * Handle OAuth callback manually.
 * After Google OAuth, Netlify redirects back with #access_token=...
 * The Identity widget should process this, but if it doesn't (broken widget),
 * we detect it and reload to let the widget retry.
 */
function handleOAuthCallback() {
  const hash = window.location.hash;
  if (hash && hash.includes("access_token=")) {
    // The widget should handle this automatically via init().
    // If after 2 seconds we still don't have a user, force a clean reload
    // (strip the hash so we don't loop).
    setTimeout(() => {
      if (!getCurrentUser()) {
        // Store a flag to avoid infinite loop
        const retries = parseInt(sessionStorage.getItem("oauth_retries") || "0");
        if (retries < 2) {
          sessionStorage.setItem("oauth_retries", String(retries + 1));
          // Reload without hash — the widget may need a fresh page
          window.location.replace(window.location.pathname);
        } else {
          // Give up after 2 retries
          sessionStorage.removeItem("oauth_retries");
          console.error("OAuth callback failed after retries");
          window.location.replace(window.location.pathname);
        }
      } else {
        sessionStorage.removeItem("oauth_retries");
      }
    }, 2000);
  } else {
    sessionStorage.removeItem("oauth_retries");
  }
}

// ── Login helpers ───────────────────────────────────────────────────────────

/**
 * Show "Entrar" button in header for unauthenticated users.
 */
function showLoginButton() {
  const container = document.getElementById("userInfo");
  if (!container) return;
  container.innerHTML = `
    <button class="btn-sm btn-login" id="loginBtn">Entrar</button>
  `;
  container.style.display = "flex";

  container.querySelector("#loginBtn")?.addEventListener("click", () => {
    requireLogin();
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

function showDevInfo() {
  showStatus("dev — sin auth");
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
