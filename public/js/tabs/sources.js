// sources.js -- Tab 1: gestion del corpus (grilla Mondrian + ficha + editor inline)

import { state, addSource, updateSource, updateSourceContent, removeSource, getExcerptsForSource, getSourceContent, loadExcerptsForSource, subscribe } from "../state.js";
import { navigateTo } from "../router.js";

// cache de textos cargados (sourceId -> text)
const textCache = new Map();
let selectedSourceId = null;

export async function initSourcesTab() {
  renderSourcesGrid();
  subscribe(() => renderSourcesGrid());
  initCorpusSearch();
  initAddSourceButton();
}

export function onSourcesActivated() {
  renderSourcesGrid();
}

// -- Grilla Mondrian de fuentes -------------------------------------------

function renderSourcesGrid() {
  const gridEl = document.getElementById("sourcesGrid");
  if (!gridEl) return;

  const all = Object.values(state.sources).map(src => {
    const excerptCount = src.excerpt_count != null
      ? Number(src.excerpt_count)
      : getExcerptsForSource(src.id).length;
    return { ...src, excerptCount };
  });

  all.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.title || "").localeCompare(b.title || ""));

  const searchInput = document.getElementById("corpusSearchInput");
  if (searchInput) searchInput.placeholder = `Buscar en los ${all.length} textos`;

  if (!all.length) {
    gridEl.innerHTML = `<p class="placeholder">No hay fuentes en el corpus</p>`;
    return;
  }

  gridEl.innerHTML = `<div class="sources-grid">${all.map(s => renderSourceCell(s)).join("")}</div>`;

  gridEl.querySelectorAll(".source-cell").forEach(cell => {
    const sid = cell.dataset.sourceId;
    cell.addEventListener("click", () => {
      selectedSourceId = sid;
      // Update selection visuals
      gridEl.querySelectorAll(".source-cell").forEach(c => c.classList.toggle("selected", c.dataset.sourceId === sid));
      renderSourceDetail(sid);
    });
  });

  // Re-apply selection if one was active
  if (selectedSourceId) {
    const sel = gridEl.querySelector(`[data-source-id="${selectedSourceId}"]`);
    if (sel) sel.classList.add("selected");
  }
}

function renderSourceCell(src) {
  const wc = src.word_count || 0;
  // Span rows based on word count (Mondrian effect)
  let rowSpan = 2;
  let colSpan = 1;
  if (wc > 15000) { rowSpan = 5; colSpan = 2; }
  else if (wc > 8000) { rowSpan = 4; colSpan = 2; }
  else if (wc > 3000) { rowSpan = 3; }

  const isSelected = src.id === selectedSourceId;

  return `
    <div class="source-cell ${isSelected ? "selected" : ""}"
         data-source-id="${src.id}"
         style="grid-row: span ${rowSpan}; grid-column: span ${colSpan}">
      <div>
        <div class="source-cell-title">${escapeHtml(src.title || src.filename)}</div>
        ${src.author ? `<div class="source-cell-author">${escapeHtml(src.author)}</div>` : ""}
      </div>
      <div class="source-cell-footer">
        <span class="source-cell-year">${escapeHtml(src.date || "")}</span>
        <span class="source-cell-words">${wc.toLocaleString()}</span>
      </div>
    </div>
  `;
}

// -- Ficha de fuente (columna derecha) ------------------------------------

async function renderSourceDetail(sourceId) {
  const container = document.getElementById("sourceDetailContent");
  if (!container || !sourceId) return;

  const src = state.sources[sourceId];
  if (!src) {
    container.innerHTML = `<p class="placeholder">Fuente no encontrada</p>`;
    return;
  }

  container.innerHTML = `<p class="placeholder">Cargando...</p>`;

  // Load excerpts for this source
  await loadExcerptsForSource(sourceId);
  const excerpts = getExcerptsForSource(sourceId);

  // Collect unique concepts from excerpts
  const conceptMap = new Map();
  for (const exc of excerpts) {
    if (exc.conceptIds) {
      for (const cid of exc.conceptIds) {
        const concept = state.concepts[cid];
        if (concept && !conceptMap.has(cid)) {
          conceptMap.set(cid, concept);
        }
      }
    }
  }
  const concepts = [...conceptMap.values()];

  const isAdmin = state.currentUser?.role === "admin";

  container.innerHTML = `
    <div class="source-detail-view">
      <div class="source-detail-header">
        <h2>${escapeHtml(src.title || src.filename)}</h2>
        <div class="source-detail-actions">
          <button class="btn-primary btn-sm" id="detailReadBtn">Leer</button>
          ${isAdmin ? `<button class="btn-sm" id="detailEditBtn">Editar</button>` : ""}
        </div>
      </div>

      <div class="source-detail-meta">
        ${src.author ? `<div><strong>Autor:</strong> ${escapeHtml(src.author)}</div>` : ""}
        ${src.date ? `<div><strong>Fecha:</strong> ${escapeHtml(src.date)}</div>` : ""}
        <div>${(src.word_count || 0).toLocaleString()} palabras</div>
      </div>

      ${excerpts.length ? `
        <div class="source-detail-section">
          <h3>${excerpts.length} secciones</h3>
          <div class="source-detail-excerpts">
            ${excerpts.map(exc => {
              const preview = (exc.text || "").slice(0, 80) + ((exc.text || "").length > 80 ? "..." : "");
              const excConcepts = (exc.conceptIds || []).map(cid => state.concepts[cid]?.label).filter(Boolean);
              return `
                <div class="source-excerpt-item" data-exc-source="${sourceId}">
                  ${escapeHtml(preview)}
                  ${excConcepts.length ? `<div class="source-excerpt-concepts">${excConcepts.map(escapeHtml).join(", ")}</div>` : ""}
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}

      ${concepts.length ? `
        <div class="source-detail-section">
          <h3>${concepts.length} conceptos</h3>
          <div class="source-detail-concepts">
            ${concepts.map(c => `<span class="source-concept-tag">${escapeHtml(c.label)}</span>`).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;

  // Event: Leer
  document.getElementById("detailReadBtn")?.addEventListener("click", () => {
    navigateTo("reader", { src: sourceId });
  });

  // Event: Editar
  document.getElementById("detailEditBtn")?.addEventListener("click", () => {
    renderSourceEditor(sourceId);
  });

  // Event: click excerpt -> go to reader
  container.querySelectorAll(".source-excerpt-item").forEach(el => {
    el.addEventListener("click", () => {
      navigateTo("reader", { src: sourceId });
    });
  });
}

// -- Editor inline (reemplaza ficha) --------------------------------------

async function renderSourceEditor(sourceId) {
  const container = document.getElementById("sourceDetailContent");
  if (!container || !sourceId) return;

  const src = state.sources[sourceId];
  if (!src) return;

  container.innerHTML = `<p class="placeholder">Cargando texto...</p>`;

  // Load content
  let content = "";
  try {
    content = await getSourceContent(sourceId) || "";
    textCache.set(sourceId, content);
  } catch {
    container.innerHTML = `<p class="placeholder">Error al cargar el texto</p>`;
    return;
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  container.innerHTML = `
    <div class="source-editor-view">
      <div class="source-editor-fields">
        <label>
          <span>Titulo</span>
          <input type="text" id="editorTitle" value="${escapeAttr(src.title)}" />
        </label>
        <label>
          <span>Autor</span>
          <input type="text" id="editorAuthor" value="${escapeAttr(src.author || "")}" placeholder="Nombre del autor" />
        </label>
        <label>
          <span>Fecha</span>
          <input type="text" id="editorDate" value="${escapeAttr(src.date || "")}" placeholder="ej: 1983" />
        </label>
      </div>

      <textarea class="source-editor-content" id="editorContent">${escapeHtml(content)}</textarea>

      <div class="source-editor-actions">
        <div>
          <button class="btn-sm btn-danger" id="editorDeleteBtn">Eliminar</button>
          <span class="source-editor-wordcount" id="editorWordCount">${wordCount.toLocaleString()} palabras</span>
        </div>
        <div class="source-editor-actions-right">
          <button class="btn-sm" id="editorCancelBtn">Cancelar</button>
          <button class="btn-primary btn-sm" id="editorSaveBtn">Guardar</button>
        </div>
      </div>
    </div>
  `;

  // Focus at beginning
  const textarea = document.getElementById("editorContent");
  if (textarea) {
    textarea.setSelectionRange(0, 0);
    textarea.scrollTop = 0;
    textarea.focus();

    textarea.addEventListener("input", () => {
      const wc = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
      const wcEl = document.getElementById("editorWordCount");
      if (wcEl) wcEl.textContent = `${wc.toLocaleString()} palabras`;
    });
  }

  // Cancel
  document.getElementById("editorCancelBtn")?.addEventListener("click", () => {
    renderSourceDetail(sourceId);
  });

  // Save
  document.getElementById("editorSaveBtn")?.addEventListener("click", async () => {
    const title = document.getElementById("editorTitle").value.trim() || src.title;
    const author = document.getElementById("editorAuthor").value.trim();
    const date = document.getElementById("editorDate").value.trim();
    const newContent = document.getElementById("editorContent").value;

    try {
      await updateSource(sourceId, { title, author, date, content: newContent });
      textCache.delete(sourceId);
      renderSourceDetail(sourceId);
    } catch (err) {
      alert("Error al guardar: " + err.message);
    }
  });

  // Delete
  document.getElementById("editorDeleteBtn")?.addEventListener("click", async () => {
    if (!confirm(`Eliminar "${src.title}" y todos sus excerpts?`)) return;
    try {
      await removeSource(sourceId);
      selectedSourceId = null;
      container.innerHTML = `<p class="placeholder">Selecciona una fuente</p>`;
    } catch (err) {
      alert("Error al eliminar: " + err.message);
    }
  });
}

// -- Obtener texto de source (export para reader) -------------------------

export async function getSourceText(sourceId) {
  if (textCache.has(sourceId)) return textCache.get(sourceId);
  const content = await getSourceContent(sourceId);
  if (content) {
    textCache.set(sourceId, content);
    return content;
  }
  return null;
}

// -- Boton Agregar fuente (admin) -----------------------------------------

function initAddSourceButton() {
  const btn = document.getElementById("addSourceBtn");
  if (!btn) return;
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const isAdmin = state.currentUser?.role === "admin";
  if (isDev || isAdmin) btn.hidden = false;
  btn.addEventListener("click", () => showImportModal());
}

// -- Modal de importacion de fuente nueva ---------------------------------

function showImportModal() {
  const prev = document.getElementById("sourceEditModal");
  if (prev) prev.remove();

  const modal = document.createElement("div");
  modal.id = "sourceEditModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-box modal-box-lg">
      <div class="modal-header">
        <h3>Agregar fuente</h3>
        <button class="btn-icon modal-close" title="Cerrar"><img src="icons/icons_close.svg" class="btn-svg-icon" alt="" /></button>
      </div>
      <form class="modal-form" id="sourceImportForm">
        <div class="modal-form-row">
          <label class="modal-field-grow">
            <span>Titulo</span>
            <input type="text" name="title" placeholder="Titulo del texto" required />
          </label>
          <label>
            <span>Fecha</span>
            <input type="text" name="date" placeholder="ej: 1983" style="width:100px" />
          </label>
        </div>
        <label>
          <span>Autor</span>
          <input type="text" name="author" placeholder="Nombre del autor" />
        </label>
        <label>
          <span>Contenido</span>
          <div class="content-editor-toolbar">
            <button type="button" class="btn-sm" id="importFileBtn">Cargar archivo .txt</button>
            <input type="file" id="importFileInput" accept=".txt,.md,.text" hidden />
            <span class="content-word-count" id="importWordCount"></span>
          </div>
          <textarea name="content" id="importContentArea" class="content-editor" placeholder="Pega o escribe el texto aqui..." required></textarea>
        </label>
        <div class="modal-actions">
          <div></div>
          <div class="modal-actions-right">
            <button type="button" class="btn-sm modal-close">Cancelar</button>
            <button type="submit" class="btn-primary btn-sm">Agregar al corpus</button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  setupModalClose(modal);

  const fileBtn = document.getElementById("importFileBtn");
  const fileInput = document.getElementById("importFileInput");
  const contentArea = document.getElementById("importContentArea");
  const wordCountEl = document.getElementById("importWordCount");

  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      contentArea.value = reader.result;
      updateWordCount(contentArea, wordCountEl);
      const titleInput = modal.querySelector('input[name="title"]');
      if (!titleInput.value) {
        titleInput.value = file.name.replace(/\.(txt|md|text)$/i, "");
      }
    };
    reader.readAsText(file);
  });

  contentArea.addEventListener("input", () => updateWordCount(contentArea, wordCountEl));

  document.getElementById("sourceImportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const title = form.get("title").trim();
    const content = form.get("content").trim();
    if (!title || !content) return;

    const filename = title.replace(/[^a-zA-Z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00c1\u00c9\u00cd\u00d3\u00da\u00d1 ]/g, "").trim() + ".txt";

    try {
      await addSource({ filename, title, author: form.get("author").trim(), date: form.get("date").trim(), content });
      modal.remove();
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  modal.querySelector('input[name="title"]').focus();
}

// -- Modal helpers --------------------------------------------------------

function setupModalClose(modal) {
  modal.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => modal.remove());
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
  const onKey = (e) => {
    if (e.key === "Escape") { modal.remove(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);
}

function updateWordCount(textarea, el) {
  if (!el) return;
  const text = textarea.value.trim();
  if (!text) { el.textContent = ""; return; }
  const words = text.split(/\s+/).length;
  el.textContent = `${words.toLocaleString()} palabras`;
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// -- Busqueda full-text en el corpus --------------------------------------

let searchTimer = null;
let allTextsLoaded = false;
const corpusTexts = new Map();

async function loadAllTexts() {
  if (allTextsLoaded) return;
  const sources = Object.values(state.sources);
  await Promise.all(sources.map(async (src) => {
    if (corpusTexts.has(src.id)) return;
    const text = await getSourceText(src.id);
    if (text) corpusTexts.set(src.id, { title: src.title || src.filename, text });
  }));
  allTextsLoaded = true;
}

function initCorpusSearch() {
  const input = document.getElementById("corpusSearchInput");
  const resultsEl = document.getElementById("corpusSearchResults");
  const gridEl = document.getElementById("sourcesGrid");
  if (!input || !resultsEl) return;

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    if (!query || query.length < 2) {
      resultsEl.hidden = true;
      if (gridEl) gridEl.hidden = false;
      return;
    }
    searchTimer = setTimeout(() => runSearch(query, resultsEl, gridEl), 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      resultsEl.hidden = true;
      if (gridEl) gridEl.hidden = false;
    }
  });
}

async function runSearch(query, resultsEl, gridEl) {
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
        sourceId, title, charPos: pos,
        before: (start > 0 ? "..." : "") + before,
        match,
        after: after + (end < text.length ? "..." : ""),
      });

      pos += query.length;
      count++;
    }
  }

  if (gridEl) gridEl.hidden = true;
  resultsEl.hidden = false;

  if (!results.length) {
    resultsEl.innerHTML = `<div class="search-summary">Sin resultados para "${escapeHtml(query)}"</div>`;
    return;
  }

  const textCount = new Set(results.map(r => r.sourceId)).size;

  let html = `<div class="search-summary">"${escapeHtml(query)}" -- ${results.length} resultado${results.length > 1 ? "s" : ""} en ${textCount} texto${textCount > 1 ? "s" : ""}</div>`;

  html += results.map(r => `
    <div class="search-result" data-source-id="${r.sourceId}" data-char-pos="${r.charPos}">
      <div class="search-result-text">${escapeHtml(r.before)}<mark>${escapeHtml(r.match)}</mark>${escapeHtml(r.after)}</div>
      <div class="search-result-source">${escapeHtml(r.title)}</div>
    </div>
  `).join("");

  resultsEl.innerHTML = html;

  resultsEl.querySelectorAll(".search-result").forEach(el => {
    el.addEventListener("click", () => {
      navigateTo("reader", { src: el.dataset.sourceId, pos: parseInt(el.dataset.charPos) });
    });
  });
}
