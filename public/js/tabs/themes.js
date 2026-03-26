// themes.js — Tab 3: mapa de conceptos + gestión de temas + notas

import {
  state, subscribe,
  addTheme, removeTheme, renameTheme,
  moveConcept,
  addNote, updateNote, removeNote, getNotesForTheme,
  addConceptNote, getNotesForConcept, loadNotesForConcept,
  getConceptsForTheme, getUngroupedConcepts,
  getExcerptsForConcept, loadExcerptsForConcept, getThemeColor,
  getSelectedConcept, setSelectedConcept,
} from "../state.js";
import { navigateTo } from "../router.js";
import * as api from "../api.js";
import { fuzzyMatch } from "../fuzzy.js";
import { renderConceptMap } from "../components/concept-map.js";
import { renderConceptMap3D, cleanupGraph3D } from "../components/concept-map-3d.js";

let currentSelection = null; // { type: "concept"|"theme", id: string }
let mapCtrl = null;
let mapMode = localStorage.getItem("constel-mapMode") || "2d";
let conceptsSectionOpen = false;

// Map filters
let filterSourceIds = [];
let filterUserIds = [];
let cachedUsers = null; // loaded once from admin API

export function initThemesTab() {
  subscribe(() => {
    const panel = document.getElementById("panel-themes");
    if (!panel?.classList.contains("active")) return;

    // NEVER re-render if user is editing anywhere in this panel
    const active = document.activeElement;
    if (active && panel.contains(active) &&
        (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      return;
    }

    renderThemeDetail();
  });

  initMapControls();

  // Refresh colors when light/dark theme changes (no layout recalc)
  new MutationObserver(() => {
    const panel = document.getElementById("panel-themes");
    if (panel?.classList.contains("active") && mapCtrl?.refreshColors) {
      mapCtrl.refreshColors();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export async function onThemesActivated() {
  // Verificar si hay un concepto seleccionado globalmente
  const selectedConceptId = getSelectedConcept();

  await renderMap();

  // Si hay un concepto seleccionado, aplicar selección en el mapa
  if (selectedConceptId && state.concepts[selectedConceptId]) {
    currentSelection = { type: "concept", id: selectedConceptId };

    // Resaltar y centrar en el mapa después de que se inicialice
    if (mapCtrl) {
      // 3D needs more time for simulation to settle and position nodes
      const delay = mapMode === "3d" ? 800 : 100;
      setTimeout(() => {
        if (mapCtrl) {
          mapCtrl.highlightNode(selectedConceptId);
        }
      }, delay);
    }
  }

  renderThemeDetail();
}

function destroyCurrentMap() {
  if (mapCtrl) {
    if (mapCtrl.simulation) mapCtrl.simulation.stop();
    if (mapCtrl.destroy) mapCtrl.destroy();
    mapCtrl = null;
  }
  cleanupGraph3D();
}

async function renderMap() {
  const container = document.getElementById("mapContainer");
  if (!container) return;

  destroyCurrentMap();

  // read current control values
  const threshSlider = document.getElementById("mapThresholdSlider");
  const edgeToggle = document.getElementById("mapEdgeToggle");
  const threshold = threshSlider ? parseInt(threshSlider.value) : 1;
  const showEdges = edgeToggle ? edgeToggle.checked : true;

  const mapOpts = {
    threshold,
    showEdges,
    sourceIds: filterSourceIds.length ? filterSourceIds : undefined,
    userIds: filterUserIds.length ? filterUserIds : undefined,
    onClickConcept: (conceptId) => {
      currentSelection = { type: "concept", id: conceptId };
      setSelectedConcept(conceptId);
      renderThemeDetail();
    },
  };

  if (mapMode === "3d") {
    mapCtrl = await renderConceptMap3D(container, mapOpts);
  } else {
    mapCtrl = await renderConceptMap(container, mapOpts);
  }
}

function initMapControls() {
  const modeToggle = document.getElementById("mapModeToggle");
  const threshSlider = document.getElementById("mapThresholdSlider");
  const threshValue = document.getElementById("mapThresholdValue");
  const strengthSlider = document.getElementById("mapStrengthSlider");
  const edgeToggle = document.getElementById("mapEdgeToggle");

  // Restore saved mode
  if (modeToggle) modeToggle.checked = mapMode === "3d";

  modeToggle?.addEventListener("change", () => {
    mapMode = modeToggle.checked ? "3d" : "2d";
    localStorage.setItem("constel-mapMode", mapMode);
    renderMap();
    // Restore selection after mode switch
    const selId = currentSelection?.type === "concept" ? currentSelection.id : getSelectedConcept();
    if (selId && mapCtrl) {
      const delay = mapMode === "3d" ? 800 : 100;
      setTimeout(() => {
        if (mapCtrl) mapCtrl.highlightNode(selId);
      }, delay);
    }
  });

  threshSlider?.addEventListener("input", () => {
    const val = parseInt(threshSlider.value);
    if (threshValue) threshValue.textContent = val;
    if (mapCtrl?.setThreshold) mapCtrl.setThreshold(val);
  });

  strengthSlider?.addEventListener("input", () => {
    const val = parseInt(strengthSlider.value);
    if (mapCtrl?.setStrength) mapCtrl.setStrength(val / 5);
  });

  edgeToggle?.addEventListener("change", () => {
    if (mapCtrl?.setEdgesVisible) mapCtrl.setEdgesVisible(edgeToggle.checked);
  });

  document.getElementById("mapExportBtn")?.addEventListener("click", exportMap);

  // Filter toggle
  const filterToggle = document.getElementById("mapFilterToggle");
  const filterPanel = document.getElementById("mapFilters");
  filterToggle?.addEventListener("click", () => {
    filterPanel.hidden = !filterPanel.hidden;
    filterToggle.classList.toggle("active", !filterPanel.hidden);
  });

  // Filter autocompletes
  initFilterInput("filterSourceInput", "filterSourceDropdown", "filterSourceTags",
    () => Object.values(state.sources).map(s => ({ id: s.id, label: `${s.title} (${s.date || ""})` })),
    filterSourceIds, renderMap
  );
  initFilterInput("filterUserInput", "filterUserDropdown", "filterUserTags",
    async () => {
      if (!cachedUsers) {
        try { cachedUsers = await api.admin.users(); } catch { cachedUsers = []; }
      }
      return cachedUsers.map(u => ({ id: u.id, label: u.name || u.email }));
    },
    filterUserIds, renderMap
  );
}

// ── Map filter helpers ──────────────────────────────────────────────────

/**
 * Set up a filter input with autocomplete dropdown and tags.
 * @param {string} inputId - ID of the text input
 * @param {string} dropdownId - ID of the dropdown container
 * @param {string} tagsId - ID of the tags container
 * @param {Function} getCandidates - async/sync fn returning [{id, label}]
 * @param {string[]} selectedIds - mutable array of selected IDs
 * @param {Function} onChanged - called after filter changes
 */
function initFilterInput(inputId, dropdownId, tagsId, getCandidates, selectedIds, onChanged) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const tagsEl = document.getElementById(tagsId);
  if (!input || !dropdown || !tagsEl) return;

  let candidates = [];
  const labelMap = {}; // id → label

  async function ensureCandidates() {
    if (!candidates.length) {
      candidates = await Promise.resolve(getCandidates());
      candidates.forEach(c => { labelMap[c.id] = c.label; });
    }
    return candidates;
  }

  input.addEventListener("focus", () => renderDropdown());
  input.addEventListener("input", () => renderDropdown());

  input.addEventListener("blur", () => {
    setTimeout(() => { dropdown.hidden = true; }, 200);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { dropdown.hidden = true; input.blur(); }
    if (e.key === "Enter") {
      const first = dropdown.querySelector(".filter-dropdown-item:not(.disabled)");
      if (first) first.click();
      e.preventDefault();
    }
  });

  async function renderDropdown() {
    const all = await ensureCandidates();
    const query = input.value.trim().toLowerCase();
    let filtered;
    if (query) {
      filtered = fuzzyMatch(query, all, 20);
    } else {
      filtered = all;
    }

    dropdown.innerHTML = filtered.map(c => {
      const selected = selectedIds.includes(c.id);
      return `<div class="filter-dropdown-item ${selected ? "disabled" : ""}" data-id="${c.id}">
        ${escapeHtml(c.label)}${selected ? " ✓" : ""}
      </div>`;
    }).join("");
    dropdown.hidden = filtered.length === 0;

    dropdown.querySelectorAll(".filter-dropdown-item:not(.disabled)").forEach(el => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const id = el.dataset.id;
        if (!selectedIds.includes(id)) {
          selectedIds.push(id);
          renderTags();
          onChanged();
        }
        input.value = "";
        dropdown.hidden = true;
      });
    });
  }

  function renderTags() {
    tagsEl.innerHTML = selectedIds.map(id => {
      const label = labelMap[id] || id;
      return `<span class="filter-tag" data-id="${id}">${escapeHtml(label)}
        <button class="filter-tag-remove" data-id="${id}"><img src="icons/icons_close.svg" class="btn-svg-icon" alt="" /></button>
      </span>`;
    }).join("");

    tagsEl.querySelectorAll(".filter-tag-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const idx = selectedIds.indexOf(id);
        if (idx >= 0) selectedIds.splice(idx, 1);
        renderTags();
        onChanged();
      });
    });
  }

  // Initial render
  renderTags();
}

async function exportMap() {
  const container = document.getElementById("mapContainer");
  if (!container) return;

  if (mapMode === "3d") {
    // 3D: capture WebGL canvas as PNG @2x
    const canvas = container.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `constel-mapa-3d-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } else {
    // 2D: serialize SVG with embedded font
    const svg = container.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true);

    // Embed Gabarito font from local repo as base64
    let fontCSS = "";
    try {
      const resp = await fetch("fonts/Gabarito-Regular.ttf");
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      fontCSS = `@font-face { font-family: 'Gabarito'; font-weight: 400; src: url(data:font/truetype;base64,${b64}) format('truetype'); }`;
    } catch {}

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fontCSS;
    defs.appendChild(style);
    clone.insertBefore(defs, clone.firstChild);

    // Inline computed styles from originals into clone
    const origTexts = svg.querySelectorAll(".map-node text");
    const cloneTexts = clone.querySelectorAll(".map-node text");
    origTexts.forEach((orig, i) => {
      const computed = window.getComputedStyle(orig);
      const cl = cloneTexts[i];
      if (!cl) return;
      cl.style.fontFamily = "'Gabarito', system-ui, sans-serif";
      cl.style.fontSize = computed.fontSize;
      cl.style.fill = computed.fill;
      cl.style.fontWeight = computed.fontWeight;
    });
    const origLinks = svg.querySelectorAll(".map-link");
    const cloneLinks = clone.querySelectorAll(".map-link");
    origLinks.forEach((orig, i) => {
      const computed = window.getComputedStyle(orig);
      const cl = cloneLinks[i];
      if (!cl) return;
      cl.setAttribute("stroke", computed.stroke);
      cl.setAttribute("stroke-opacity", computed.strokeOpacity || orig.getAttribute("stroke-opacity") || "0.4");
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const data = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `constel-mapa-2d-${new Date().toISOString().slice(0, 10)}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }
}

function renderThemeDetail() {
  const container = document.getElementById("themeDetailContent");
  const titleEl = document.getElementById("themeDetailTitle");
  if (!container) return;

  if (currentSelection?.type === "concept") {
    renderConceptDetail(container, titleEl, currentSelection.id);
  } else if (currentSelection?.type === "theme") {
    renderThemeNotes(container, titleEl, currentSelection.id);
  } else {
    renderThemeOverview(container, titleEl);
  }
}

function renderThemeOverview(container, titleEl) {
  titleEl.textContent = "Temas";

  const themes = Object.values(state.themes);
  const ungrouped = getUngroupedConcepts();

  let html = "";

  for (const theme of themes) {
    const concepts = getConceptsForTheme(theme.id);
    const notes = getNotesForTheme(theme.id);
    html += `
      <div class="theme-section">
        <div class="theme-section-header">
          <span class="theme-color-dot" style="background: ${theme.color}"></span>
          <h3 class="theme-label" data-theme="${theme.id}">${escapeHtml(theme.label)}</h3>
          <span class="badge">${concepts.length}</span>
          <button class="btn-sm btn-icon-only" data-select-theme="${theme.id}"><img class="chevron-icon" src="icons/icons_chevron-right.svg" alt="ver" /></button>
        </div>
        <div class="theme-concepts">
          ${concepts.map(c => `
            <span class="concept-tag" style="border-color: ${theme.color}; background: ${theme.color}20"
                  data-select-concept="${c.id}">
              ${escapeHtml(c.label)}
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (ungrouped.length) {
    html += `
      <div class="ungrouped-section">
        <div class="theme-section-header">
          <h3>Sin tema definido</h3>
          <span class="badge">${ungrouped.length}</span>
        </div>
        <div class="theme-concepts">
          ${ungrouped.map(c => `
            <span class="concept-tag" style="border-color: var(--muted)"
                  data-select-concept="${c.id}">
              ${escapeHtml(c.label)}
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  // formulario nuevo tema
  html += `
    <div class="new-theme-form">
      <input type="text" id="newThemeInput" placeholder="Nuevo tema...">
      <button class="btn-primary btn-sm" id="createThemeBtn">Crear</button>
    </div>
  `;

  container.innerHTML = html;

  // listeners
  container.querySelectorAll("[data-select-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentSelection = { type: "theme", id: btn.dataset.selectTheme };
      renderThemeDetail();
    });
  });

  container.querySelectorAll("[data-select-concept]").forEach(tag => {
    tag.addEventListener("click", () => {
      currentSelection = { type: "concept", id: tag.dataset.selectConcept };
      renderThemeDetail();
    });
  });

  document.getElementById("createThemeBtn")?.addEventListener("click", () => {
    const input = document.getElementById("newThemeInput");
    const label = input?.value.trim();
    if (label) {
      addTheme(label);
      input.value = "";
    }
  });

  document.getElementById("newThemeInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("createThemeBtn")?.click();
  });
}

async function renderConceptDetail(container, titleEl, conceptId) {
  const concept = state.concepts[conceptId];
  if (!concept) { renderThemeOverview(container, titleEl); return; }

  titleEl.textContent = concept.label;

  // Load excerpts and notes in parallel
  let excerpts = getExcerptsForConcept(conceptId);
  let notes = getNotesForConcept(conceptId);
  if (!excerpts.length || !notes.length) {
    container.innerHTML = `<p class="placeholder">Cargando...</p>`;
    const [excResult, noteResult] = await Promise.all([
      excerpts.length ? excerpts : loadExcerptsForConcept(conceptId),
      loadNotesForConcept(conceptId),
    ]);
    if (!excerpts.length) excerpts = excResult;
    notes = getNotesForConcept(conceptId);
  }
  const themes = Object.values(state.themes);

  let html = `
    <button class="btn-sm" style="margin-bottom: var(--space-md)" id="backToOverviewTop">\u2190 Todos los temas</button>
    <div style="margin-bottom: var(--space-md)">
      <label style="font-size: var(--font-size-sm); color: var(--muted)">Tema:</label>
      <select id="conceptThemeSelect" style="margin-left: var(--space-sm); padding: var(--space-xs)">
        <option value="">Sin tema definido</option>
        ${themes.map(t => `
          <option value="${t.id}" ${concept.themeId === t.id ? "selected" : ""}>
            ${escapeHtml(t.label)}
          </option>
        `).join("")}
      </select>
    </div>

    <div class="concept-notes-section">
      ${notes.map(n => `
        <div class="concept-note" data-note-id="${n.id}">
          <div class="concept-note-text">${escapeHtml(n.text)}</div>
          <div class="concept-note-meta">
            ${escapeHtml(n.created_by_name || "")}
            ${n.created_by === state.currentUser?.id ? `<button class="btn-link concept-note-edit" data-note-id="${n.id}">editar</button>` : ""}
            ${n.created_by === state.currentUser?.id || state.currentUser?.role === "admin" ? `<button class="btn-link btn-link-danger concept-note-delete" data-note-id="${n.id}">eliminar</button>` : ""}
          </div>
        </div>
      `).join("")}
      <div class="concept-note-add">
        <textarea id="newConceptNote" rows="2" placeholder="Agregar una nota sobre este concepto..."></textarea>
        <button class="btn-sm" id="addConceptNoteBtn">Agregar nota</button>
      </div>
    </div>

    <div style="margin-bottom: var(--space-sm)">
      <label style="font-size: var(--font-size-sm); color: var(--muted)">${excerpts.length} secciones</label>
    </div>
    <div class="excerpt-list">
      ${excerpts.map(exc => {
        const src = state.sources[exc.sourceId];
        return `
          <div class="excerpt-item" data-source="${exc.sourceId}" data-excerpt="${exc.id}">
            ${escapeHtml(exc.text.slice(0, 200))}${exc.text.length > 200 ? "..." : ""}
            <div class="excerpt-source">${escapeHtml(src?.title || src?.filename || "?")}</div>
          </div>
        `;
      }).join("")}
    </div>
    <button class="btn-sm" style="margin-top: var(--space-md)" id="backToOverview">\u2190 Todos los temas</button>
  `;

  container.innerHTML = html;

  // Add note
  container.querySelector("#addConceptNoteBtn")?.addEventListener("click", async () => {
    const textarea = container.querySelector("#newConceptNote");
    const text = textarea?.value?.trim();
    if (!text) return;
    await addConceptNote(conceptId, text);
    renderConceptDetail(container, titleEl, conceptId);
  });

  // Edit own note (inline)
  container.querySelectorAll(".concept-note-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      const noteDiv = btn.closest(".concept-note");
      const textDiv = noteDiv.querySelector(".concept-note-text");
      const currentText = textDiv.textContent;
      textDiv.innerHTML = `
        <textarea class="concept-note-textarea">${escapeHtml(currentText)}</textarea>
        <button class="btn-sm concept-note-save" data-note-id="${noteId}">Guardar</button>
      `;
      const saveBtn = textDiv.querySelector(".concept-note-save");
      saveBtn.addEventListener("click", async () => {
        const newText = textDiv.querySelector("textarea").value.trim();
        if (newText) {
          await updateNote(noteId, newText);
          renderConceptDetail(container, titleEl, conceptId);
        }
      });
    });
  });

  // Delete note
  container.querySelectorAll(".concept-note-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const noteId = btn.dataset.noteId;
      await removeNote(noteId);
      renderConceptDetail(container, titleEl, conceptId);
    });
  });

  // Change theme
  container.querySelector("#conceptThemeSelect")?.addEventListener("change", (e) => {
    moveConcept(conceptId, e.target.value || null);
    renderMap();
  });

  // Click excerpt -> reader
  container.querySelectorAll(".excerpt-item").forEach(item => {
    item.addEventListener("click", () => {
      navigateTo("reader", { src: item.dataset.source, exc: item.dataset.excerpt });
    });
  });

  const backBtns = container.querySelectorAll("#backToOverview, #backToOverviewTop");
  backBtns.forEach(btn => {
    btn?.addEventListener("click", () => {
      currentSelection = null;
      renderThemeDetail();
    });
  });
}

function renderThemeNotes(container, titleEl, themeId) {
  const theme = state.themes[themeId];
  if (!theme) { renderThemeOverview(container, titleEl); return; }

  titleEl.textContent = theme.label;

  const concepts = getConceptsForTheme(themeId);
  const ungrouped = getUngroupedConcepts();
  const notes = getNotesForTheme(themeId);
  const allExcerpts = concepts.flatMap(c => getExcerptsForConcept(c.id));

  // deduplicar excerpts
  const seen = new Set();
  const excerpts = allExcerpts.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

  let html = `
    <button class="btn-sm" style="margin-bottom: var(--space-md)" id="backToOverviewTop">← Todos los temas</button>
    <div class="theme-detail-top">
      <div class="theme-section-header" style="margin-bottom: var(--space-xs)">
        <span class="theme-color-dot" style="background: ${theme.color}"></span>
        <input class="theme-title-input" id="themeTitleInput" type="text" value="${escapeHtml(theme.label)}" spellcheck="false" />
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: var(--space-sm)">
        <button class="btn-toggle-concepts" id="toggleConceptsBtn">
          <img class="chevron-icon" id="conceptsChevron" src="icons/icons_chevron-right.svg" alt="" />
          ${concepts.length} conceptos · ${excerpts.length} §
        </button>
        <button class="btn-sm btn-danger" id="deleteThemeBtn">Eliminar tema</button>
      </div>
    </div>

    <div class="theme-concepts-section" id="conceptsCollapsible" ${conceptsSectionOpen ? '' : 'hidden'}>
      <div class="theme-concepts" style="margin-bottom: var(--space-xs)">
        ${concepts.map(c => `
          <span class="concept-tag removable" style="border-color: ${theme.color}; background: ${theme.color}20"
                data-concept-id="${c.id}" data-select-concept="${c.id}">
            ${escapeHtml(c.label)}
            <button class="tag-remove" data-remove-concept="${c.id}" title="Quitar del tema"><img src="icons/icons_close.svg" class="btn-svg-icon" alt="" /></button>
          </span>
        `).join("")}
      </div>
      ${ungrouped.length ? `
        <div class="add-concepts-to-theme">
          <label style="font-size: var(--font-size-sm); color: var(--muted); display: block; margin-bottom: var(--space-xs)">Agregar:</label>
          <div class="theme-concepts ungrouped-picker">
            ${ungrouped.map(c => `
              <span class="concept-tag addable" style="border-color: var(--muted)"
                    data-add-concept="${c.id}">
                + ${escapeHtml(c.label)}
              </span>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>

    <div class="note-editor">
      <label>Desarrollo de ${escapeHtml(theme.label)}</label>
      <textarea id="themeNoteText" placeholder="Escribe aquí tu síntesis, implicancias, argumentos...">${escapeHtml(notes[0]?.text || "")}</textarea>
    </div>

    ${excerpts.length ? `
    <div class="theme-excerpts-section">
      <label style="font-size: var(--font-size-sm); color: var(--muted); display: block; margin-bottom: var(--space-xs)">
        ${excerpts.length} secciones de este tema:
      </label>
      <div class="excerpt-list">
        ${excerpts.map(exc => {
          const src = state.sources[exc.sourceId];
          const conceptLabels = exc.conceptIds
            .map(cid => state.concepts[cid])
            .filter(c => c && concepts.some(tc => tc.id === c.id))
            .map(c => c.label);
          const conceptStr = conceptLabels.length ? conceptLabels.join(", ") : "";
          const srcLabel = src?.title || src?.filename || "?";
          return `
            <div class="excerpt-item" data-source="${exc.sourceId}" data-excerpt="${exc.id}">
              <div class="excerpt-quote">${escapeHtml(exc.text)}</div>
              <div class="excerpt-meta">
                ${conceptStr ? `<strong>${escapeHtml(conceptStr)}</strong>` : ""}
                <span class="excerpt-meta-arrow">→</span>
                <span class="excerpt-meta-source">${escapeHtml(srcLabel)}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
    ` : ""}

    <button class="btn-sm" style="margin-top: var(--space-md)" id="backToOverview">← Todos los temas</button>
  `;

  container.innerHTML = html;

  // toggle conceptos
  const toggleBtn = container.querySelector("#toggleConceptsBtn");
  const collapsible = container.querySelector("#conceptsCollapsible");
  const chevron = container.querySelector("#conceptsChevron");

  // Actualizar chevron según estado actual
  chevron.src = conceptsSectionOpen ? "icons/icons_chevron-down.svg" : "icons/icons_chevron-right.svg";

  toggleBtn?.addEventListener("click", () => {
    conceptsSectionOpen = !conceptsSectionOpen;
    collapsible.hidden = !conceptsSectionOpen;
    chevron.src = conceptsSectionOpen ? "icons/icons_chevron-down.svg" : "icons/icons_chevron-right.svg";
  });

  // rename tema
  const titleInput = container.querySelector("#themeTitleInput");
  titleInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); titleInput.blur(); }
  });
  titleInput?.addEventListener("blur", () => {
    const newLabel = titleInput.value.trim();
    if (newLabel && newLabel !== theme.label) {
      renameTheme(themeId, newLabel);
      renderMap();
    }
  });

  // delete tema
  container.querySelector("#deleteThemeBtn")?.addEventListener("click", () => {
    if (confirm(`¿Eliminar tema "${theme.label}"? Los conceptos quedarán sin agrupar.`)) {
      removeTheme(themeId);
      currentSelection = null;
      renderMap();
      renderThemeDetail();
    }
  });

  // guardar nota con debounce
  let noteTimer;
  const textarea = container.querySelector("#themeNoteText");
  textarea?.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const text = textarea.value;
      if (notes[0]) {
        updateNote(notes[0].id, text);
      } else if (text.trim()) {
        addNote(themeId, text);
      }
    }, 500);
  });

  // click concept tag → ver detalle del concepto
  container.querySelectorAll("[data-select-concept]").forEach(tag => {
    tag.addEventListener("click", (e) => {
      if (e.target.classList.contains("tag-remove")) return;
      currentSelection = { type: "concept", id: tag.dataset.selectConcept };
      renderThemeDetail();
    });
  });

  // ✕ quitar concepto del tema
  container.querySelectorAll("[data-remove-concept]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveConcept(btn.dataset.removeConcept, null);
      renderMap();
    });
  });

  // + agregar concepto al tema
  container.querySelectorAll("[data-add-concept]").forEach(tag => {
    tag.addEventListener("click", () => {
      moveConcept(tag.dataset.addConcept, themeId);
      renderMap();
    });
  });

  container.querySelectorAll(".excerpt-item").forEach(item => {
    item.addEventListener("click", () => {
      navigateTo("reader", { src: item.dataset.source, exc: item.dataset.excerpt });
    });
  });

  const backBtns = container.querySelectorAll("#backToOverview, #backToOverviewTop");
  backBtns.forEach(btn => {
    btn?.addEventListener("click", () => {
      currentSelection = null;
      renderThemeDetail();
    });
  });
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
