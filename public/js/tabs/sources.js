// sources.js — Tab 1: gestión del corpus

import { state, addSource, updateSource, removeSource, getExcerptsForSource, getSourceContent, subscribe } from "../state.js";
import { navigateTo } from "../router.js";

// cache de textos cargados (sourceId → text)
const textCache = new Map();

export async function initSourcesTab() {
  renderSourcesList();
  subscribe(() => renderSourcesList());
  initCorpusSearch();
}

export function onSourcesActivated() {
  renderSourcesList();
}

function renderSourcesList() {
  const listEl = document.getElementById("sourcesListContent");
  const searchInput = document.getElementById("corpusSearchInput");
  if (!listEl) return;

  const all = Object.values(state.sources).map(src => {
    const excerpts = getExcerptsForSource(src.id);
    return { ...src, excerptCount: excerpts.length };
  });

  // sort by date, then title
  all.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.title || "").localeCompare(b.title || ""));

  if (searchInput) searchInput.placeholder = `Buscar en los ${all.length} textos`;

  if (!all.length) {
    listEl.innerHTML = `<p class="placeholder">No hay fuentes en el corpus</p>`;
    return;
  }

  listEl.innerHTML = `<div class="source-list">${all.map(s => renderSourceCard(s)).join("")}</div>`;

  // event listeners
  listEl.querySelectorAll(".source-card").forEach(card => {
    const sid = card.dataset.sourceId;

    card.addEventListener("click", () => {
      if (sid) navigateTo("reader", { src: sid });
    });
    card.addEventListener("mouseenter", () => previewSource(sid));

    const editBtn = card.querySelector(".source-edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showEditModal(sid);
      });
    }
  });
}

function renderSourceCard(src) {
  const pct = src.word_count > 0 ? Math.round((countMarkedChars(src.id) / (src.word_count * 5)) * 100) : 0;
  const metaParts = [src.author, src.date].filter(Boolean);
  const metaLine = metaParts.join(" · ");

  return `
    <div class="card source-card" data-source-id="${src.id}">
      <div class="source-card-header">
        <h3>${escapeHtml(src.title || src.filename)}</h3>
        <button class="btn-icon source-edit-btn" title="Editar metadatos"><img src="icons/icons_edit.svg" class="btn-svg-icon" alt="" /></button>
      </div>
      ${metaLine ? `<div class="source-author">${escapeHtml(metaLine)}</div>` : ""}
      <div class="source-meta">
        <span class="stat">${src.excerptCount || 0} §</span>
        <span class="stat">${src.word_count || "?"} palabras</span>
      </div>
      ${src.word_count > 0 ? `
        <div class="source-progress">
          <div class="source-progress-bar" style="width: ${Math.min(pct, 100)}%"></div>
        </div>
      ` : ""}
    </div>
  `;
}

async function previewSource(sourceId) {
  const previewEl = document.getElementById("sourcePreviewContent");
  if (!previewEl || !sourceId) return;

  if (textCache.has(sourceId)) {
    showPreview(previewEl, textCache.get(sourceId));
    return;
  }

  previewEl.innerHTML = `<p class="placeholder">Cargando...</p>`;
  try {
    const content = await getSourceContent(sourceId);
    if (content) {
      textCache.set(sourceId, content);
      showPreview(previewEl, content);
    } else {
      previewEl.innerHTML = `<p class="placeholder">Sin contenido</p>`;
    }
  } catch {
    previewEl.innerHTML = `<p class="placeholder">No se pudo cargar el texto</p>`;
  }
}

function showPreview(el, text) {
  const maxChars = 3000;
  const truncated = text.length > maxChars;
  el.textContent = truncated ? text.slice(0, maxChars) : text;
  if (truncated) {
    el.innerHTML += `<p class="preview-truncated">... (${text.length.toLocaleString()} caracteres en total)</p>`;
  }
}

function countMarkedChars(sourceId) {
  if (!sourceId) return 0;
  const excerpts = getExcerptsForSource(sourceId);
  const chars = new Set();
  for (const e of excerpts) {
    const start = e.start_pos ?? e.start;
    const end = e.end_pos ?? e.end;
    if (typeof start === "number" && typeof end === "number") {
      for (let i = start; i < end; i++) chars.add(i);
    }
  }
  return chars.size;
}

/**
 * Obtiene el texto de un source (desde cache o API).
 */
export async function getSourceText(sourceId) {
  if (textCache.has(sourceId)) return textCache.get(sourceId);
  const content = await getSourceContent(sourceId);
  if (content) {
    textCache.set(sourceId, content);
    return content;
  }
  return null;
}

// ── Modal de edición de metadatos ────────────────────────────────────────────

function showEditModal(sourceId) {
  const src = state.sources[sourceId];
  if (!src) return;

  const prev = document.getElementById("sourceEditModal");
  if (prev) prev.remove();

  const modal = document.createElement("div");
  modal.id = "sourceEditModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>Editar fuente</h3>
        <button class="btn-icon modal-close" title="Cerrar">✕</button>
      </div>
      <form class="modal-form" id="sourceEditForm">
        <label>
          <span>Título</span>
          <input type="text" name="title" value="${escapeAttr(src.title)}" />
        </label>
        <label>
          <span>Autor</span>
          <input type="text" name="author" value="${escapeAttr(src.author || "")}" placeholder="Nombre del autor" />
        </label>
        <label>
          <span>Fecha</span>
          <input type="text" name="date" value="${escapeAttr(src.date || "")}" placeholder="ej: 1983, 2026-03-15" />
        </label>
        <hr />
        <div class="modal-filename">${escapeHtml(src.filename)}</div>
        <div class="modal-actions">
          <button type="button" class="btn-sm btn-danger" id="sourceDeleteBtn">Eliminar fuente</button>
          <div class="modal-actions-right">
            <button type="button" class="btn-sm modal-close">Cancelar</button>
            <button type="submit" class="btn-primary btn-sm">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => modal.remove());
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const onKey = (e) => { if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);

  document.getElementById("sourceDeleteBtn").addEventListener("click", async () => {
    if (!confirm(`¿Eliminar "${src.title}" y todos sus excerpts?`)) return;
    removeSource(sourceId);
    modal.remove();
  });

  document.getElementById("sourceEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    updateSource(sourceId, {
      title: form.get("title").trim() || src.title,
      author: form.get("author").trim(),
      date: form.get("date").trim(),
    });
    modal.remove();
  });

  modal.querySelector('input[name="title"]').select();
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// ── Búsqueda full-text en el corpus ─────────────────────────────────────────

let searchTimer = null;
let allTextsLoaded = false;
const corpusTexts = new Map(); // sourceId → { title, text }

async function loadAllTexts() {
  if (allTextsLoaded) return;
  const sources = Object.values(state.sources);
  await Promise.all(sources.map(async (src) => {
    if (corpusTexts.has(src.id)) return;
    const text = await getSourceText(src.id);
    if (text) {
      corpusTexts.set(src.id, { title: src.title || src.filename, text });
    }
  }));
  allTextsLoaded = true;
}

function initCorpusSearch() {
  const input = document.getElementById("corpusSearchInput");
  const resultsEl = document.getElementById("corpusSearchResults");
  const listEl = document.getElementById("sourcesListContent");
  if (!input || !resultsEl) return;

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();

    if (!query || query.length < 2) {
      resultsEl.hidden = true;
      listEl.hidden = false;
      return;
    }

    searchTimer = setTimeout(() => runSearch(query, resultsEl, listEl), 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      resultsEl.hidden = true;
      listEl.hidden = false;
    }
  });
}

async function runSearch(query, resultsEl, listEl) {
  await loadAllTexts();

  const queryLower = query.toLowerCase();
  const results = [];
  const CONTEXT = 60;

  for (const [sourceId, { title, text }] of corpusTexts) {
    const textLower = text.toLowerCase();
    let pos = 0;
    let count = 0;

    while ((pos = textLower.indexOf(queryLower, pos)) !== -1 && count < 5) {
      const start = Math.max(0, pos - CONTEXT);
      const end = Math.min(text.length, pos + query.length + CONTEXT);
      const before = text.slice(start, pos);
      const match = text.slice(pos, pos + query.length);
      const after = text.slice(pos + query.length, end);

      results.push({
        sourceId,
        title,
        charPos: pos,
        before: (start > 0 ? "…" : "") + before,
        match,
        after: after + (end < text.length ? "…" : ""),
      });

      pos += query.length;
      count++;
    }
  }

  listEl.hidden = true;
  resultsEl.hidden = false;

  if (!results.length) {
    resultsEl.innerHTML = `<div class="search-summary">Sin resultados para "${escapeHtml(query)}"</div>`;
    return;
  }

  const textCount = new Set(results.map(r => r.sourceId)).size;

  let html = `<div class="search-summary">"${escapeHtml(query)}" — ${results.length} resultado${results.length > 1 ? "s" : ""} en ${textCount} texto${textCount > 1 ? "s" : ""}</div>`;

  html += results.map(r => `
    <div class="search-result" data-source-id="${r.sourceId}" data-char-pos="${r.charPos}">
      <div class="search-result-text">${escapeHtml(r.before)}<mark>${escapeHtml(r.match)}</mark>${escapeHtml(r.after)}</div>
      <div class="search-result-source">${escapeHtml(r.title)}</div>
    </div>
  `).join("");

  resultsEl.innerHTML = html;

  resultsEl.querySelectorAll(".search-result").forEach(el => {
    el.addEventListener("click", () => {
      const sourceId = el.dataset.sourceId;
      const charPos = parseInt(el.dataset.charPos);
      navigateTo("reader", { src: sourceId, pos: charPos });
    });
  });
}
