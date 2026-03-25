// reader.js — Tab 2: lector con selección y etiquetado

import {
  state, subscribe,
  addExcerpt, addConcept, addConceptToExcerpt,
  findConceptByLabel, getExcerptsForSource, getExcerptsForConcept, getSource,
  removeConcept, renameConcept, removeConceptFromExcerpt, removeExcerpt,
  setSelectedConcept, getSelectedConcept,
} from "../state.js";
import { navigateTo } from "../router.js";
import { renderHighlightedText, scrollToExcerpt, getRenderedSourceText } from "../components/text-highlighter.js";
import { initExcerptPopup } from "../components/popup.js";
import { initAutocomplete } from "../components/autocomplete.js";
import { renderMinimap } from "../components/minimap.js";
import { renderConceptGloss } from "../components/concept-gloss.js";
import { getSourceText } from "./sources.js";

let currentSourceId = null;
let currentText = null;
let popupController = null;
let autocompleteController = null;
let glossController = null;
let selectedConceptId = null;
let lastExcerptHash = "";
let marksVisible = true;

export function initReaderTab() {
  const popup = document.getElementById("excerptPopup");
  const readerContent = document.getElementById("readerTextContent");
  const input = document.getElementById("conceptInput");
  const dropdown = document.getElementById("autocompleteDropdown");

  popupController = initExcerptPopup({
    popup,
    readerContent,
    onCreateExcerpt: handleCreateExcerpt,
  });

  const createBtn = document.getElementById("createExcerpt");
  autocompleteController = initAutocomplete(input, dropdown, (conceptData) => {
    input.value = conceptData.label;
    createBtn.click();
  });

  document.getElementById("backToSources")?.addEventListener("click", () => {
    navigateTo("sources");
  });

  // concept detail: close
  document.getElementById("conceptDetailClose")?.addEventListener("click", () => {
    closeConceptDetail();
  });

  // concept detail: delete (custom confirm dialog)
  const confirmOverlay = document.getElementById("confirmDeleteOverlay");
  const confirmMsg = document.getElementById("confirmDeleteMsg");
  const confirmOk = document.getElementById("confirmDeleteOk");
  const confirmCancel = document.getElementById("confirmDeleteCancel");

  document.getElementById("conceptDetailDelete")?.addEventListener("click", () => {
    if (!selectedConceptId) return;
    const c = state.concepts[selectedConceptId];
    if (!c) return;
    const excerptCount = Object.values(state.excerpts).filter(e => e.conceptIds?.includes(selectedConceptId)).length;
    confirmMsg.textContent = `¿Eliminar «${c.label}»? Tiene ${excerptCount} sección${excerptCount !== 1 ? "es" : ""}.`;
    confirmOverlay.classList.add("visible");
  });

  confirmOk?.addEventListener("click", () => {
    confirmOverlay.classList.remove("visible");
    if (selectedConceptId) {
      removeConcept(selectedConceptId);
      closeConceptDetail();
    }
  });

  confirmCancel?.addEventListener("click", () => {
    confirmOverlay.classList.remove("visible");
  });

  confirmOverlay?.addEventListener("click", (e) => {
    if (e.target === confirmOverlay) confirmOverlay.classList.remove("visible");
  });

  // concept detail: add section
  document.getElementById("conceptDetailAddExcerpt")?.addEventListener("click", () => {
    if (!selectedConceptId || !currentSourceId) return;
    enterAddSectionMode(selectedConceptId);
  });

  // concept detail: rename
  const labelInput = document.getElementById("conceptDetailLabel");
  labelInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); labelInput.blur(); }
  });
  labelInput?.addEventListener("blur", () => {
    if (!selectedConceptId) return;
    const newLabel = labelInput.value.trim();
    if (newLabel && state.concepts[selectedConceptId] && newLabel !== state.concepts[selectedConceptId].label) {
      renameConcept(selectedConceptId, newLabel);
      showToast(`Concepto renombrado → [${newLabel}]`);
    }
  });

  // state changes → selective re-render
  subscribe(() => {
    if (!currentSourceId || !currentText) return;

    const hash = computeExcerptHash();
    const changed = hash !== lastExcerptHash;

    if (changed) {
      lastExcerptHash = hash;
      renderTextAndMinimap(currentSourceId, currentText);
      rebuildGloss(currentSourceId, currentText.length);
    }

    if (selectedConceptId && changed) {
      renderConceptDetailExcerpts(selectedConceptId);
    }
  });

  initResizer();
  initMarksToggle();
}

export async function onReaderActivated(params) {
  const sourceId = params.src;
  if (!sourceId) return;

  const preservedConceptId = selectedConceptId;

  if (sourceId === currentSourceId && currentText) {
    if (params.exc) {
      setTimeout(() => {
        scrollToExcerpt(document.getElementById("readerTextContent"), params.exc);
      }, 100);
    } else if (params.pos != null) {
      setTimeout(() => scrollToCharPos(parseInt(params.pos)), 100);
    }
    return;
  }

  const src = getSource(sourceId);
  if (!src) return;

  // Show title in tab bar
  const title = src.title || src.filename;
  document.getElementById("readerTitle").textContent = title;
  document.getElementById("tabSourceTitle").classList.add("visible");

  currentSourceId = sourceId;
  lastExcerptHash = "";
  const readerContent = document.getElementById("readerTextContent");
  readerContent.innerHTML = `<p class="placeholder">Cargando...</p>`;

  currentText = await getSourceText(sourceId);
  if (!currentText) {
    readerContent.innerHTML = `<p class="placeholder">No se pudo cargar el texto</p>`;
    return;
  }

  lastExcerptHash = computeExcerptHash();
  renderTextAndMinimap(sourceId, currentText);
  rebuildGloss(sourceId, currentText.length);

  // restore concept selection
  if (preservedConceptId && state.concepts[preservedConceptId]) {
    selectedConceptId = preservedConceptId;
    const panel = document.getElementById("conceptDetail");
    const labelInput = document.getElementById("conceptDetailLabel");
    panel.hidden = false;
    labelInput.value = state.concepts[preservedConceptId].label;
    renderConceptDetailExcerpts(preservedConceptId);
    if (glossController) glossController.update(preservedConceptId);

    const exc = params.exc
      ? params.exc
      : getExcerptsForSource(sourceId).find(e => e.conceptIds.includes(preservedConceptId))?.id;
    if (exc) {
      setTimeout(() => scrollToExcerpt(document.getElementById("readerTextContent"), exc), 150);
    }
  } else {
    closeConceptDetail();
    if (params.exc) {
      setTimeout(() => scrollToExcerpt(document.getElementById("readerTextContent"), params.exc), 150);
    } else if (params.pos != null) {
      setTimeout(() => scrollToCharPos(parseInt(params.pos)), 200);
    }
  }
}

// ── Render helpers ──────────────────────────────────────────────────────

function renderTextAndMinimap(sourceId, text) {
  const readerContent = document.getElementById("readerTextContent");
  const minimapContainer = document.getElementById("readerMinimap");
  // The scrollable container is the parent .reader-text-panel
  const scrollContainer = document.getElementById("readerText");

  renderHighlightedText(readerContent, text, sourceId, (excerptId) => {
    const exc = state.excerpts[excerptId];
    if (exc && exc.conceptIds.length > 0) {
      openConceptDetail(exc.conceptIds[0]);
    }
  });

  // preserve marks visibility state after re-render
  readerContent.classList.toggle("marks-hidden", !marksVisible);

  renderMinimap(minimapContainer, sourceId, text.length, scrollContainer);
}

function rebuildGloss(sourceId, textLength) {
  const container = document.getElementById("readerGlossList");
  const countEl = document.getElementById("readerConceptCount");

  const excerpts = getExcerptsForSource(sourceId);
  const conceptIds = new Set();
  for (const exc of excerpts) {
    for (const cid of exc.conceptIds) conceptIds.add(cid);
  }
  countEl.textContent = conceptIds.size;

  if (glossController) glossController.cleanup();

  glossController = renderConceptGloss(container, sourceId, textLength, {
    onClickConcept: (conceptId) => {
      if (selectedConceptId === conceptId) {
        closeConceptDetail();
      } else {
        openConceptDetail(conceptId);
      }
    },
    selectedConceptId,
  });
}

// ── Concept Detail Panel ──────────────────────────────────────────────

function openConceptDetail(conceptId) {
  const c = state.concepts[conceptId];
  if (!c) return;

  selectedConceptId = conceptId;
  setSelectedConcept(conceptId); // actualizar selección global
  const panel = document.getElementById("conceptDetail");
  const labelInput = document.getElementById("conceptDetailLabel");

  panel.hidden = false;
  labelInput.value = c.label;
  renderConceptDetailExcerpts(conceptId);

  // update gloss selection
  if (glossController) glossController.update(conceptId);

  // scroll to first excerpt in current text
  const excerpts = getExcerptsForSource(currentSourceId);
  const firstExc = excerpts.find(e => e.conceptIds.includes(conceptId));
  if (firstExc) {
    scrollToExcerpt(document.getElementById("readerTextContent"), firstExc.id);
  }
}

function closeConceptDetail() {
  selectedConceptId = null;
  setSelectedConcept(null); // limpiar selección global
  document.getElementById("conceptDetail").hidden = true;
  if (glossController) glossController.update(null);
}

function renderConceptDetailExcerpts(conceptId) {
  const container = document.getElementById("conceptDetailExcerpts");
  const allExcerpts = getExcerptsForConcept(conceptId);

  if (!allExcerpts.length) {
    container.innerHTML = `<p class="placeholder" style="font-size:var(--font-size-sm)">Sin excerpts</p>`;
    return;
  }

  // Split into current source vs. others
  const local = allExcerpts
    .filter(e => e.sourceId === currentSourceId)
    .sort((a, b) => a.start - b.start);

  const others = allExcerpts
    .filter(e => e.sourceId !== currentSourceId)
    .sort((a, b) => {
      const sa = state.sources[a.sourceId]?.title || "";
      const sb = state.sources[b.sourceId]?.title || "";
      return sa.localeCompare(sb) || a.start - b.start;
    });

  let html = "";

  // ── Secciones in vivo (texto actual)
  if (local.length) {
    const currentSrc = state.sources[currentSourceId];
    const currentLabel = currentSrc ? (currentSrc.title || currentSrc.filename) : "Texto actual";
    html += `<div class="excerpt-group-header current">§ en este texto <span class="excerpt-group-count">${local.length}</span></div>`;
    html += local.map(exc => renderExcerptItem(exc, true)).join("");
  }

  // ── Secciones en otros textos
  if (others.length) {
    html += `<div class="excerpt-group-header other">En otros textos <span class="excerpt-group-count">${others.length}</span></div>`;
    html += others.map(exc => renderExcerptItem(exc, false)).join("");
  }

  container.innerHTML = html;

  // click excerpt → scroll or navigate
  container.querySelectorAll(".concept-detail-excerpt").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("excerpt-remove")) return;
      const excId = el.dataset.excId;
      const srcId = el.dataset.sourceId;

      if (srcId === currentSourceId) {
        scrollToExcerpt(document.getElementById("readerTextContent"), excId);
      } else {
        navigateTo("reader", { src: srcId, exc: excId });
      }
    });
  });

  // ✕ remove
  container.querySelectorAll(".excerpt-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const excId = btn.dataset.excId;
      removeConceptFromExcerpt(excId, conceptId);
      const exc = state.excerpts[excId];
      if (exc && exc.conceptIds.length === 0) {
        removeExcerpt(excId);
      }
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function renderExcerptItem(exc, isLocal) {
  const src = state.sources[exc.sourceId];
  const srcLabel = src ? (src.title || src.filename) : "?";
  const preview = exc.text.length > 140 ? exc.text.slice(0, 140) + "…" : exc.text;

  return `<div class="concept-detail-excerpt${isLocal ? " local" : " other-source"}" data-exc-id="${exc.id}" data-source-id="${exc.sourceId}">
    <button class="excerpt-remove" data-exc-id="${exc.id}" title="Desvincular">✕</button>
    §&ensp;${escapeHtml(preview)}
    ${isLocal ? "" : `<div class="excerpt-source">${escapeHtml(srcLabel)}</div>`}
  </div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Scroll to a character position in the rendered text.
 * Walks text nodes to find the right position, then scrolls.
 */
function scrollToCharPos(charPos) {
  const container = document.getElementById("readerTextContent");
  if (!container) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent.length;

    if (pos + len > charPos) {
      // found the text node — create a temporary highlight
      const offset = charPos - pos;
      const range = document.createRange();
      range.setStart(node, Math.min(offset, len));
      range.setEnd(node, Math.min(offset + 20, len)); // highlight ~20 chars

      // scroll into view
      const rect = range.getBoundingClientRect();
      const scrollParent = container.closest(".panel-content") || container.parentElement;
      if (scrollParent && rect) {
        const parentRect = scrollParent.getBoundingClientRect();
        scrollParent.scrollTop += rect.top - parentRect.top - parentRect.height / 3;
      }

      // flash effect
      const span = document.createElement("span");
      span.className = "search-flash";
      range.surroundContents(span);
      setTimeout(() => {
        const parent = span.parentNode;
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize();
      }, 2000);

      return;
    }
    pos += len;
  }
}

function computeExcerptHash() {
  const excerpts = getExcerptsForSource(currentSourceId);
  // include concept labels to detect renames
  return excerpts.map(e => e.id + ":" + e.conceptIds.join(",")).join("|")
    + "|c:" + Object.values(state.concepts).map(c => c.id + c.label).join(",");
}

// ── Create excerpt ────────────────────────────────────────────────────

function handleCreateExcerpt({ text, start, end, conceptLabel }) {
  if (!currentSourceId || !conceptLabel) return;

  let concept = findConceptByLabel(conceptLabel);
  let conceptId;

  if (concept) {
    conceptId = concept.id;
  } else {
    conceptId = addConcept(conceptLabel);
  }

  const excerptId = addExcerpt({
    sourceId: currentSourceId,
    text,
    start,
    end,
    conceptIds: [conceptId],
  });

  showToast(`§ marcado como [${conceptLabel}]`);

  setTimeout(() => {
    scrollToExcerpt(document.getElementById("readerTextContent"), excerptId);
    openConceptDetail(conceptId);
  }, 150);
}

// ── Add section mode ──────────────────────────────────────────────────

let addSectionConceptId = null;

function enterAddSectionMode(conceptId) {
  const c = state.concepts[conceptId];
  if (!c) return;

  addSectionConceptId = conceptId;
  const readerContent = document.getElementById("readerTextContent");
  readerContent.classList.add("add-section-mode");

  showToast(`Selecciona texto para agregar otra § a [${c.label}]`);

  function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    const sourceText = getRenderedSourceText();
    const container = document.getElementById("readerTextContent");

    const startOffset = getTextOffset(container, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(container, range.endContainer, range.endOffset);

    if (startOffset === -1 || endOffset === -1 || startOffset >= endOffset) {
      sel.removeAllRanges();
      return;
    }

    const excerptId = addExcerpt({
      sourceId: currentSourceId,
      text: sourceText.slice(startOffset, endOffset),
      start: startOffset,
      end: endOffset,
      conceptIds: [addSectionConceptId],
    });

    sel.removeAllRanges();
    exitAddSectionMode();

    showToast(`§ agregada a [${c.label}]`);

    setTimeout(() => {
      scrollToExcerpt(document.getElementById("readerTextContent"), excerptId);
      openConceptDetail(addSectionConceptId);
    }, 150);
  }

  readerContent.addEventListener("mouseup", onMouseUp, { once: true });

  function onKeyDown(e) {
    if (e.key === "Escape") {
      exitAddSectionMode();
      document.removeEventListener("keydown", onKeyDown);
      readerContent.removeEventListener("mouseup", onMouseUp);
    }
  }
  document.addEventListener("keydown", onKeyDown);
}

function exitAddSectionMode() {
  addSectionConceptId = null;
  document.getElementById("readerTextContent").classList.remove("add-section-mode");
}

function getTextOffset(container, node, offset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return pos + offset;
    pos += walker.currentNode.textContent.length;
  }
  return -1;
}

function showToast(message) {
  const old = document.querySelector(".excerpt-created-toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.className = "excerpt-created-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toast.addEventListener("animationend", () => toast.remove());
}

const SVG_NS = "http://www.w3.org/2000/svg";
const EYE_OPEN_PATHS = [
  { d: "M17.7,13.5c0,2-1.6,3.7-3.7,3.7s-3.7-1.6-3.7-3.7,1.6-3.7,3.7-3.7,3.7,1.6,3.7,3.7" },
  { d: "M14,10.9c3.9,0,7.6,1.2,10.7,3.2-2.2-3.6-6.1-6.1-10.7-6.1s-8.5,2.4-10.7,6.1c3.1-2,6.7-3.2,10.7-3.2" },
  { d: "M21,17.8c-2.2.8-4.5,1.3-7,1.3s-4.8-.5-7-1.3c2,1.4,4.4,2.3,7,2.3s5-.8,7-2.3" },
  { d: "M16.7,12.3c0,.8-.7,1.5-1.5,1.5s-1.5-.7-1.5-1.5.7-1.5,1.5-1.5,1.5.7,1.5,1.5", cls: "eye-glint" },
];
const EYE_CLOSE_PATHS = [
  { d: "M14,17c3.9,0,7.6-1.2,10.7-3.2-2.2,3.6-6.1,6.1-10.7,6.1s-8.5-2.4-10.7-6.1c3.1,2,6.7,3.2,10.7,3.2" },
];

function setSvgPaths(svg, paths) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  for (const p of paths) {
    const el = document.createElementNS(SVG_NS, "path");
    el.setAttribute("d", p.d);
    if (p.cls) el.setAttribute("class", p.cls);
    svg.appendChild(el);
  }
}

function initMarksToggle() {
  const btn = document.getElementById("marksToggle");
  const icon = document.getElementById("marksToggleIcon");
  if (!btn || !icon) return;

  btn.addEventListener("click", () => {
    marksVisible = !marksVisible;
    setSvgPaths(icon, marksVisible ? EYE_OPEN_PATHS : EYE_CLOSE_PATHS);
    const readerContent = document.getElementById("readerTextContent");
    if (readerContent) {
      readerContent.classList.toggle("marks-hidden", !marksVisible);
    }
  });
}

function initResizer() {
  const resizer = document.getElementById("readerResizer");
  const gloss = document.getElementById("readerGloss");
  if (!resizer || !gloss) return;

  let startX = 0;
  let startW = 0;

  function onMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = gloss.offsetWidth;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const newW = Math.max(160, Math.min(window.innerWidth * 0.5, startW + dx));
    gloss.style.width = newW + "px";
  }

  function onMouseUp() {
    resizer.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    // rebuild gloss for new dimensions
    if (currentSourceId && currentText) {
      rebuildGloss(currentSourceId, currentText.length);
      if (selectedConceptId && glossController) {
        glossController.update(selectedConceptId);
      }
    }
  }

  resizer.addEventListener("mousedown", onMouseDown);
}
