// escuela.js -- Tab 4: gestion de usuarios, actividad y estadisticas (solo admin)

import { state } from "../state.js";
import * as api from "../api.js";

let currentUsers = [];
let currentActivity = [];
let currentStats = null;
let selectedUserId = null;

/**
 * Inject tab button and panel into DOM (called only for admins).
 */
export function injectEscuelaTab() {
  // Tab button
  const tabsBar = document.querySelector(".tabs-bar");
  if (!tabsBar || tabsBar.querySelector('[data-tab="escuela"]')) return;

  const btn = document.createElement("button");
  btn.className = "tab-btn";
  btn.dataset.tab = "escuela";
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-selected", "false");
  btn.innerHTML = `<img src="icons/icons_school.svg" class="tab-icon" alt="" /> <span>Escuela</span>`;
  tabsBar.appendChild(btn);

  // Click handler for router
  btn.addEventListener("click", () => {
    location.hash = "#escuela";
  });

  // Tab panel
  const panels = document.querySelector(".tab-panels");
  if (!panels) return;

  const section = document.createElement("section");
  section.className = "tab-panel";
  section.id = "panel-escuela";
  section.setAttribute("role", "tabpanel");
  section.innerHTML = `
    <div class="split-view" data-split="escuela">
      <div class="split-left">
        <div class="panel-header">
          <h2>Usuarios</h2>
        </div>
        <div class="panel-content" id="escuelaUserList">
          <p class="placeholder">Cargando...</p>
        </div>
      </div>
      <div class="split-handle" data-split="escuela"></div>
      <div class="split-right">
        <div class="panel-header">
          <h2 id="escuelaRightTitle">Corpus</h2>
        </div>
        <div class="panel-content" id="escuelaRightPanel">
          <p class="placeholder">Cargando...</p>
        </div>
      </div>
    </div>
  `;
  panels.appendChild(section);
}

export function initEscuelaTab() {
  // Nothing to subscribe to at init -- data loads on activation
}

export async function onEscuelaActivated() {
  await Promise.all([
    loadUsers(),
    loadStats(),
    loadActivity(),
  ]);
  renderUserList();
  renderRightPanel();
}

// -- Data loading --

async function loadUsers() {
  try {
    currentUsers = await api.admin.users();
  } catch (e) {
    console.error("Error loading users:", e);
    currentUsers = [];
  }
}

async function loadStats() {
  try {
    currentStats = await api.admin.stats();
  } catch (e) {
    console.error("Error loading stats:", e);
    currentStats = null;
  }
}

async function loadActivity(userId = null) {
  try {
    currentActivity = await api.admin.activity(100, userId);
  } catch (e) {
    console.error("Error loading activity:", e);
    currentActivity = [];
  }
}

// -- Render users --

function renderUserList() {
  const container = document.getElementById("escuelaUserList");
  if (!container) return;

  if (!currentUsers.length) {
    container.innerHTML = `<p class="placeholder">No hay usuarios registrados</p>`;
    return;
  }

  container.innerHTML = `
    <div class="escuela-user-list">
      ${currentUsers.map(u => `
        <div class="escuela-user-row ${selectedUserId === u.id ? "selected" : ""}" data-user-id="${u.id}">
          <div class="escuela-user-info">
            ${u.avatar_url
              ? `<img class="escuela-avatar" src="${escapeAttr(u.avatar_url)}" alt="" />`
              : `<div class="escuela-avatar escuela-avatar-placeholder">${(u.name || u.email || "?")[0].toUpperCase()}</div>`
            }
            <div class="escuela-user-details">
              <div class="escuela-user-name">${escapeHtml(u.name || u.email)}</div>
              <div class="escuela-user-email">${escapeHtml(u.email)}</div>
            </div>
          </div>
          <div class="escuela-user-meta">
            <span class="escuela-stat">${u.excerpt_count || 0} sec</span>
            <span class="escuela-stat">${u.concept_count || 0} con</span>
            <select class="escuela-role-select" data-user-id="${u.id}" ${u.id === state.currentUser?.id ? "disabled" : ""}>
              <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
            </select>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // Click user row -> filter activity
  container.querySelectorAll(".escuela-user-row").forEach(row => {
    row.addEventListener("click", async (e) => {
      if (e.target.closest(".escuela-role-select")) return;
      const userId = row.dataset.userId;
      selectedUserId = selectedUserId === userId ? null : userId;
      renderUserList();
      await loadActivity(selectedUserId);
      renderRightPanel();
    });
  });

  // Change role
  container.querySelectorAll(".escuela-role-select").forEach(select => {
    select.addEventListener("change", async (e) => {
      const userId = select.dataset.userId;
      const newRole = e.target.value;
      const user = currentUsers.find(u => u.id === userId);
      const name = user?.name || user?.email || userId;

      if (!confirm(`Cambiar rol de ${name} a "${newRole}"?`)) {
        // revert select
        e.target.value = user.role;
        return;
      }

      try {
        await api.admin.setRole(userId, newRole);
        user.role = newRole;
        renderUserList();
      } catch (err) {
        console.error("Error changing role:", err);
        alert("Error al cambiar rol");
        e.target.value = user.role;
      }
    });
  });
}

// -- Render right panel (stats + activity) --

function renderRightPanel() {
  const container = document.getElementById("escuelaRightPanel");
  const titleEl = document.getElementById("escuelaRightTitle");
  if (!container) return;

  if (selectedUserId) {
    const user = currentUsers.find(u => u.id === selectedUserId);
    titleEl.textContent = user?.name || user?.email || "Usuario";
  } else {
    titleEl.textContent = "Corpus";
  }

  container.innerHTML = `
    ${!selectedUserId ? renderStats() : ""}
    <div class="escuela-activity-section">
      <h3 class="escuela-section-title">${selectedUserId ? "Actividad" : "Actividad reciente"}</h3>
      ${renderActivityLog()}
    </div>
  `;
}

function renderStats() {
  if (!currentStats) return "";

  const items = [
    { label: "Fuentes", value: currentStats.source_count },
    { label: "Secciones", value: currentStats.excerpt_count },
    { label: "Conceptos", value: currentStats.concept_count },
    { label: "Temas", value: currentStats.theme_count },
    { label: "Usuarios", value: currentStats.user_count },
  ];

  return `
    <div class="escuela-stats">
      ${items.map(s => `
        <div class="escuela-stat-card">
          <div class="escuela-stat-value">${s.value ?? "?"}</div>
          <div class="escuela-stat-label">${s.label}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderActivityLog() {
  if (!currentActivity.length) {
    return `<p class="placeholder">Sin actividad registrada</p>`;
  }

  return `
    <div class="escuela-activity-list">
      ${currentActivity.map(a => {
        const time = new Date(a.created_at).toLocaleString("es-CL", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
        });
        return `
          <div class="escuela-activity-row">
            <span class="escuela-activity-action">${formatAction(a.action)}</span>
            <span class="escuela-activity-entity">${escapeHtml(a.entity_type)}</span>
            <span class="escuela-activity-user">${escapeHtml(a.user_name || "")}</span>
            <span class="escuela-activity-time">${time}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function formatAction(action) {
  const map = {
    create_excerpt: "creo seccion",
    delete_excerpt: "elimino seccion",
    create_concept: "creo concepto",
    delete_concept: "elimino concepto",
    link_concept: "vinculo concepto",
    unlink_concept: "desvinculo concepto",
    create_theme: "creo tema",
    delete_theme: "elimino tema",
    add_concept_to_theme: "agrego a tema",
    remove_concept_from_theme: "quito de tema",
    create_note: "creo nota",
    update_note: "edito nota",
    delete_note: "elimino nota",
    create_source: "importo fuente",
    update_source: "edito fuente",
    delete_source: "elimino fuente",
    set_role: "cambio rol",
  };
  return map[action] || action;
}

// -- Helpers --

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}
