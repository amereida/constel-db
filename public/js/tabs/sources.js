// sources.js — Tab 1: gestión del corpus

import { api } from "../api.js";
import { state, addSource, updateSource, getExcerptsForSource, subscribe } from "../state.js";
import { navigateTo } from "../router.js";

// cache de textos cargados (filename → text)
const textCache = new Map();

export async function initSourcesTab() {
  await renderSourcesList();
  subscribe(() => renderSourcesList());
  initCorpusSearch();
}

export function onSourcesActivated() {
  renderSourcesList();
}

async function renderSourcesList() {
  const listEl = document.getElementById("sourcesListContent");
  const searchInput = document.getElementById("corpusSearchInput");
  if (!listEl) return;

  // obtener archivos del corpus
  let corpusFiles = [];
  try {
    const res = await api.listCorpus();
    corpusFiles = res.files || [];
  } catch {}

  // merge: sources del estado + archivos aún no importados
  const imported = new Set(Object.values(state.sources).map(s => s.filename));
  const all = [];

  // primero los ya importados
  for (const src of Object.values(state.sources)) {
    const excerpts = getExcerptsForSource(src.id);
    all.push({ ...src, excerptCount: excerpts.length, imported: true });
  }

  // luego los pendientes
  for (const f of corpusFiles) {
    if (!imported.has(f.filename)) {
      all.push({
        filename: f.filename,
        title: f.filename.replace(/\.(txt|md)$/, ""),
        size: f.size,
        imported: false,
      });
    }
  }

  if (searchInput) searchInput.placeholder = `Buscar en los ${all.length} textos`;

  if (!all.length) {
    listEl.innerHTML = `<p class="placeholder">Coloca archivos .txt o .md en la carpeta corpus/</p>`;
    return;
  }

  listEl.innerHTML = `<div class="source-list">${all.map(s => renderSourceCard(s)).join("")}</div>`;

  // event listeners
  listEl.querySelectorAll(".source-card").forEach(card => {
    const fn = card.dataset.filename;
    const sid = card.dataset.sourceId;

    card.addEventListener("click", () => handleSourceClick(fn, sid));
    card.addEventListener("mouseenter", () => previewSource(fn));

    // edit button (only for imported sources)
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
  const pct = src.wordCount > 0 ? Math.round((countMarkedChars(src.id) / (src.wordCount * 5)) * 100) : 0;
  // Build metadata line: code · role · date
  const codeLine = src.code || src.participant || "";
  const roleLine = src.role || "";
  const metaParts = [codeLine, roleLine, src.date].filter(Boolean);
  const metaLine = metaParts.join(" · ");

  return `
    <div class="card source-card" data-filename="${src.filename}" data-source-id="${src.id || ""}">
      <div class="source-card-header">
        <h3>${escapeHtml(src.title || src.filename)}</h3>
        <button class="btn-icon source-edit-btn" title="Editar metadatos"><img src="icons/icons_edit.svg" class="btn-svg-icon" alt="" /></button>
      </div>
      ${metaLine ? `<div class="source-author">${escapeHtml(metaLine)}</div>` : ""}
      <div class="source-meta">
        ${src.imported
          ? `<span class="stat">${src.excerptCount || 0} §</span>
             <span class="stat">${src.wordCount || "?"} palabras</span>`
          : `<span class="stat" style="color:var(--accent)">Por importar</span>
             <span class="stat">${src.size ? Math.round(src.size / 1024) + " KB" : ""}</span>`
        }
      </div>
      ${src.imported && src.wordCount > 0 ? `
        <div class="source-progress">
          <div class="source-progress-bar" style="width: ${Math.min(pct, 100)}%"></div>
        </div>
      ` : ""}
    </div>
  `;
}

async function handleSourceClick(filename, sourceId) {
  if (sourceId) {
    // ya importado → ir al reader
    navigateTo("reader", { src: sourceId });
    return;
  }

  // importar el texto (con frontmatter)
  try {
    const res = await api.readSource(filename);
    const words = res.text.split(/\s+/).length;
    const meta = res.meta || {};
    // título: code si existe (T2, D2), sino title del frontmatter, sino filename
    const displayTitle = meta.code
      ? `${meta.code}${meta.participant ? " — " + meta.participant : ""}`
      : meta.title || filename.replace(/\.(txt|md)$/, "");
    const id = addSource({
      filename,
      title: displayTitle,
      author: meta.author || "",
      date: meta.date || "",
      wordCount: words,
    });
    // guardar campos extra del frontmatter
    const extra = {};
    if (meta.code) extra.code = meta.code;
    if (meta.participant) extra.participant = meta.participant;
    if (meta.role) extra.role = meta.role;
    if (meta.field) extra.field = meta.field;
    if (meta.type) extra.type = meta.type;
    if (meta.notes) extra.notes = meta.notes;
    if (Object.keys(extra).length) updateSource(id, extra);

    textCache.set(filename, res.text);
    navigateTo("reader", { src: id });
  } catch (e) {
    console.error("Error importando:", e);
  }
}

async function previewSource(filename) {
  const previewEl = document.getElementById("sourcePreviewContent");
  if (!previewEl) return;

  // buscar en cache
  if (textCache.has(filename)) {
    showPreview(previewEl, textCache.get(filename));
    return;
  }

  previewEl.innerHTML = `<p class="placeholder">Cargando...</p>`;
  try {
    const res = await api.readSource(filename);
    textCache.set(filename, res.text);
    showPreview(previewEl, res.text);
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
    if (typeof e.start === "number" && typeof e.end === "number") {
      for (let i = e.start; i < e.end; i++) chars.add(i);
    }
  }
  return chars.size;
}

/**
 * Obtiene el texto de un source (desde cache o servidor).
 */
export async function getSourceText(sourceId) {
  const src = state.sources[sourceId];
  if (!src) return null;
  if (textCache.has(src.filename)) return textCache.get(src.filename);

  // intentar desde la API (servidor o fetch estático)
  try {
    const res = await api.readSource(src.filename);
    textCache.set(src.filename, res.text);
    return res.text;
  } catch {}

  // fallback: corpus guardado en localStorage (desde import ZIP)
  try {
    const cached = JSON.parse(localStorage.getItem("constel-corpus") || "{}");
    if (cached[src.filename]) {
      textCache.set(src.filename, cached[src.filename]);
      return cached[src.filename];
    }
  } catch {}

  return null;
}

// ── Modal de edición de metadatos ────────────────────────────────────────────

function showEditModal(sourceId) {
  const src = state.sources[sourceId];
  if (!src) return;

  // remover modal previo si existe
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
        <label>
          <span>Participante</span>
          <input type="text" name="participant" value="${escapeAttr(src.participant || "")}" placeholder="ej: P-07 (para entrevistas)" />
        </label>
        <label>
          <span>Rol</span>
          <input type="text" name="role" value="${escapeAttr(src.role || "")}" placeholder="ej: diseñador senior" />
        </label>
        <label>
          <span>Notas</span>
          <textarea name="notes" rows="2" placeholder="Notas sobre esta fuente...">${escapeHtml(src.notes || "")}</textarea>
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

  // cerrar con click en overlay o botón ✕
  modal.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => modal.remove());
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // escape key
  const onKey = (e) => { if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);

  // eliminar fuente
  document.getElementById("sourceDeleteBtn").addEventListener("click", async () => {
    if (!confirm(`¿Eliminar "${src.title}" y todos sus excerpts?`)) return;
    const { removeSource } = await import("../state.js");
    removeSource(sourceId);
    modal.remove();
  });

  // guardar
  document.getElementById("sourceEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);

    updateSource(sourceId, {
      title: form.get("title").trim() || src.title,
      author: form.get("author").trim(),
      date: form.get("date").trim(),
      participant: form.get("participant").trim(),
      role: form.get("role").trim(),
      notes: form.get("notes").trim(),
    });

    modal.remove();
  });

  // focus en título
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

  // Escape cierra búsqueda
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
  const CONTEXT = 60; // chars de contexto a cada lado

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

  // mostrar resultados
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

  // click → navegar al reader
  resultsEl.querySelectorAll(".search-result").forEach(el => {
    el.addEventListener("click", () => {
      const sourceId = el.dataset.sourceId;
      const charPos = parseInt(el.dataset.charPos);
      navigateTo("reader", { src: sourceId, pos: charPos });
    });
  });
}
