// router.js — navegación por tabs via hash

const TABS = ["sources", "reader", "themes"];
const tabCallbacks = new Map();
let currentTab = "sources";
let currentParams = {};

export function onTabChange(tab, fn) {
  if (!tabCallbacks.has(tab)) tabCallbacks.set(tab, []);
  tabCallbacks.get(tab).push(fn);
}

export function getCurrentTab() { return currentTab; }
export function getParams() { return currentParams; }

export function navigateTo(tab, params = {}) {
  let hash = `#${tab}`;
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  if (qs) hash += `?${qs}`;
  location.hash = hash;
}

function parseHash() {
  const raw = location.hash.slice(1) || "sources";
  const [tab, qs] = raw.split("?");
  const params = {};
  if (qs) {
    for (const pair of qs.split("&")) {
      const [k, v] = pair.split("=");
      if (k) params[k] = decodeURIComponent(v || "");
    }
  }
  return { tab: TABS.includes(tab) ? tab : "sources", params };
}

function applyRoute() {
  const { tab, params } = parseHash();
  currentTab = tab;
  currentParams = params;

  // actualizar UI de tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive);
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `panel-${tab}`);
  });

  // mostrar título del texto solo en reader
  const titleEl = document.getElementById("tabSourceTitle");
  if (titleEl) {
    titleEl.classList.toggle("visible", tab === "reader");
  }

  // notificar callbacks
  const fns = tabCallbacks.get(tab) || [];
  for (const fn of fns) {
    try { fn(params); } catch (e) { console.error(`router callback error [${tab}]:`, e); }
  }
}

export function initRouter() {
  // click en tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.tab));
  });

  window.addEventListener("hashchange", applyRoute);
  applyRoute();
}
