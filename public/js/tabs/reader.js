// reader.js — Tab 2: lector con selección y etiquetado

import {
  state, subscribe, loadExcerptsForSource,
  addExcerpt, addConcept, addConceptToExcerpt,
  findConceptByLabel, getExcerptsForSource, getExcerptsForConcept, getSource,
  removeConcept, renameConcept, removeConceptFromExcerpt, removeExcerpt,
  setSelectedConcept, getSelectedConcept,
  updateSourceContent,
} from "../state.js";
import { navigateTo } from "../router.js";
import { renderHighlightedText, scrollToExcerpt, getCurrentSourceRaw, insertMilestones } from "../components/text-highlighter.js";
import { initExcerptPopup } from "../components/popup.js";
import { initAutocomplete } from "../components/autocomplete.js";
import { renderMinimap } from "../components/minimap.js";
import { renderConceptGloss } from "../components/concept-gloss.js";
import { getSourceText } from "./sources.js";
import { getCurrentUser, requireLogin } from "../api.js";

let currentSourceId = null;
let currentText = null;
let popupController = null;
let autocompleteController = null;
let glossController = null;
let selectedConceptId = null;
let lastExcerptHash = "";
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
    const allLinked = Object.values(state.excerpts).filter(e => e.conceptIds?.includes(selectedConceptId));
    const orphanCount = allLinked.filter(e => e.conceptIds.length === 1).length;
    const sharedCount = allLinked.length - orphanCount;
    let msg = `¿Eliminar «${c.label}»?`;
    if (orphanCount > 0) msg += ` Se eliminarán ${orphanCount} sección${orphanCount !== 1 ? "es" : ""} exclusiva${orphanCount !== 1 ? "s" : ""}.`;
    if (sharedCount > 0) msg += ` ${sharedCount} sección${sharedCount !== 1 ? "es" : ""} compartida${sharedCount !== 1 ? "s" : ""} se conservarán.`;
    confirmMsg.textContent = msg;
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
  initMarksSwitch();
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
  const sidenotesCol = document.getElementById("readerSidenotes");
  if (sidenotesCol) sidenotesCol.innerHTML = "";

  // Load text and excerpts in parallel
  const [text] = await Promise.all([
    getSourceText(sourceId),
    loadExcerptsForSource(sourceId),
  ]);
  currentText = text;
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

  renderHighlightedText(readerContent, text, sourceId, (excerptId, markEl) => {
    showExcerptPopover(excerptId, markEl);
  });

  // preserve marks visibility state after re-render
  applyMarksVisibility();

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
    container.innerHTML = `<p class="placeholder">Sin excerpts</p>`;
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
      // Backend handles orphan cleanup: if excerpt has 0 concepts, it gets deleted
      removeConceptFromExcerpt(excId, conceptId);
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function renderExcerptItem(exc, isLocal) {
  const src = state.sources[exc.sourceId];
  const srcLabel = src ? (src.title || src.filename) : "?";
  const preview = exc.text.length > 140 ? exc.text.slice(0, 140) + "…" : exc.text;

  return `<div class="concept-detail-excerpt${isLocal ? " local" : " other-source"}" data-exc-id="${exc.id}" data-source-id="${exc.sourceId}">
    <button class="excerpt-remove" data-exc-id="${exc.id}" title="Desvincular"><img src="icons/icons_close.svg" class="btn-svg-icon" alt="" /></button>
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

// ── Excerpt popover (click on mark) ──────────────────────────────────

function showExcerptPopover(excerptId, markEl) {
  // Close any existing popover
  closeExcerptPopover();

  const exc = state.excerpts[excerptId];
  if (!exc) return;

  // Also open the concept detail sidebar for the first concept
  if (exc.conceptIds.length > 0) {
    openConceptDetail(exc.conceptIds[0]);
  }

  const concepts = exc.conceptIds
    .map(cid => state.concepts[cid])
    .filter(Boolean);

  const popover = document.createElement("div");
  popover.className = "excerpt-popover";
  popover.innerHTML = `
    <div class="excerpt-popover-concepts">
      ${concepts.map(c => `
        <span class="excerpt-popover-tag" data-concept-id="${c.id}">${escapeHtml(c.label)}</span>
      `).join("")}
    </div>
    <div class="excerpt-popover-add">
      <input type="text" class="excerpt-popover-input" placeholder="+ concepto" autocomplete="off" />
      <div class="excerpt-popover-dropdown" hidden></div>
    </div>
  `;

  // Position below the mark
  const rect = markEl.getBoundingClientRect();
  const scrollParent = markEl.closest(".reader-text-panel");
  const parentRect = scrollParent?.getBoundingClientRect() || { left: 0, top: 0 };

  popover.style.position = "absolute";
  popover.style.left = `${rect.left - parentRect.left + scrollParent.scrollLeft}px`;
  popover.style.top = `${rect.bottom - parentRect.top + scrollParent.scrollTop + 4}px`;

  // Append to the scroll container so it scrolls with the text
  scrollParent?.appendChild(popover);

  // Click concept tag → open its detail
  popover.querySelectorAll(".excerpt-popover-tag").forEach(tag => {
    tag.addEventListener("click", (e) => {
      e.stopPropagation();
      openConceptDetail(tag.dataset.conceptId);
    });
  });

  // Input: add concept to this excerpt
  const input = popover.querySelector(".excerpt-popover-input");
  const dropdown = popover.querySelector(".excerpt-popover-dropdown");

  input.addEventListener("keyup", (e) => {
    const val = input.value.trim().toLowerCase();
    if (val.length < 1) { dropdown.hidden = true; return; }

    // Fuzzy match existing concepts
    const matches = Object.values(state.concepts)
      .filter(c => c.label.toLowerCase().includes(val) && !exc.conceptIds.includes(c.id))
      .slice(0, 6);

    if (matches.length === 0 && val.length >= 2) {
      dropdown.innerHTML = `<div class="excerpt-popover-option new" data-label="${escapeHtml(val)}">+ crear "${escapeHtml(val)}"</div>`;
      dropdown.hidden = false;
    } else if (matches.length > 0) {
      dropdown.innerHTML = matches.map(c =>
        `<div class="excerpt-popover-option" data-concept-id="${c.id}">${escapeHtml(c.label)}</div>`
      ).join("");
      // Also show "create new" option if no exact match
      if (!matches.find(c => c.label.toLowerCase() === val)) {
        dropdown.innerHTML += `<div class="excerpt-popover-option new" data-label="${escapeHtml(val)}">+ crear "${escapeHtml(val)}"</div>`;
      }
      dropdown.hidden = false;
    } else {
      dropdown.hidden = true;
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeExcerptPopover(); return; }
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) linkConceptToExcerpt(excerptId, val, markEl);
    }
  });

  // Click on dropdown option
  dropdown.addEventListener("click", (e) => {
    const opt = e.target.closest(".excerpt-popover-option");
    if (!opt) return;
    e.stopPropagation();
    if (opt.dataset.conceptId) {
      addConceptToExcerpt(excerptId, opt.dataset.conceptId);
      closeExcerptPopover();
      showToast(`+ ${opt.textContent.trim()}`);
    } else if (opt.dataset.label) {
      linkConceptToExcerpt(excerptId, opt.dataset.label, markEl);
    }
  });

  // Focus input
  setTimeout(() => input.focus(), 50);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", _popoverOutsideClick);
  }, 100);
}

function _popoverOutsideClick(e) {
  const popover = document.querySelector(".excerpt-popover");
  if (popover && !popover.contains(e.target) && !e.target.closest("mark[data-excerpt]")) {
    closeExcerptPopover();
  }
}

function closeExcerptPopover() {
  document.querySelectorAll(".excerpt-popover").forEach(el => el.remove());
  document.removeEventListener("click", _popoverOutsideClick);
}

async function linkConceptToExcerpt(excerptId, label, markEl) {
  if (!requireLogin()) return;
  try {
    let concept = findConceptByLabel(label);
    let conceptId;
    if (concept) {
      conceptId = concept.id;
    } else {
      conceptId = await addConcept(label);
    }
    await addConceptToExcerpt(excerptId, conceptId);
    closeExcerptPopover();
    showToast(`+ ${label}`);
    openConceptDetail(conceptId);
  } catch (err) {
    console.error("Error linking concept:", err);
    showToast(`Error: ${err.message}`);
  }
}

// ── Create excerpt ────────────────────────────────────────────────────

async function handleCreateExcerpt({ text, conceptLabel }) {
  if (!currentSourceId || !conceptLabel) return;

  // Require login to create excerpts
  if (!requireLogin()) return;

  // Immediately show toast (instant feedback)
  showToast(`§ [${conceptLabel}] …`);

  try {
    // Step 1: Get or create concept
    let concept = findConceptByLabel(conceptLabel);
    let conceptId;
    if (concept) {
      conceptId = concept.id;
    } else {
      conceptId = await addConcept(conceptLabel);
    }

    // Step 2: Create excerpt (server returns the ID)
    const excerptId = await addExcerpt({
      sourceId: currentSourceId,
      text,
      conceptIds: [conceptId],
    });

    // Step 3: Insert milestones into the source markdown
    const sourceRaw = getCurrentSourceRaw();
    const updatedSource = insertMilestones(sourceRaw, text, excerptId);
    if (updatedSource) {
      await updateSourceContent(currentSourceId, updatedSource);
    } else {
      console.warn("insertMilestones failed: text not found in source for", excerptId);
    }

    showToast(`§ [${conceptLabel}]`);

    requestAnimationFrame(() => {
      scrollToExcerpt(document.getElementById("readerTextContent"), excerptId);
      openConceptDetail(conceptId);
    });
  } catch (err) {
    showToast(`Error: ${err.message}`);
    console.error("handleCreateExcerpt:", err);
    // Remove any lingering saving-highlight
    document.querySelectorAll(".saving-highlight").forEach(el => el.remove());
  }
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

  async function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    try {
      const excerptId = await addExcerpt({
        sourceId: currentSourceId,
        text: selectedText,
        conceptIds: [addSectionConceptId],
      });

      // Insert milestones into the source
      const sourceRaw = getCurrentSourceRaw();
      const updatedSource = insertMilestones(sourceRaw, selectedText, excerptId);
      if (updatedSource) {
        await updateSourceContent(currentSourceId, updatedSource);
      }

      sel.removeAllRanges();
      exitAddSectionMode();

      showToast(`§ agregada a [${c.label}]`);

      setTimeout(() => {
        scrollToExcerpt(document.getElementById("readerTextContent"), excerptId);
        openConceptDetail(addSectionConceptId);
      }, 150);
    } catch (err) {
      console.error("addSection:", err);
      showToast(`Error: ${err.message}`);
    }
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

function showToast(message) {
  const old = document.querySelector(".excerpt-created-toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.className = "excerpt-created-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toast.addEventListener("animationend", () => toast.remove());
}

// Marks visibility: "all" | "mine" | "none"
let marksMode = "all";

function initMarksSwitch() {
  const container = document.getElementById("marksSwitch");
  if (!container) return;

  const btns = container.querySelectorAll(".marks-switch-btn");
  const indicator = container.querySelector(".marks-switch-indicator");

  function updateIndicator() {
    const activeBtn = container.querySelector(".marks-switch-btn.active");
    if (activeBtn && indicator) {
      indicator.style.width = activeBtn.offsetWidth + "px";
      indicator.style.transform = `translateX(${activeBtn.offsetLeft - 2}px)`;
    }
  }

  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      marksMode = btn.dataset.marks;
      updateIndicator();
      applyMarksVisibility();
    });
  });

  // Set initial indicator position after render
  requestAnimationFrame(updateIndicator);
}

function applyMarksVisibility() {
  const readerContent = document.getElementById("readerTextContent");
  if (!readerContent) return;

  const userId = state.currentUser?.id;

  readerContent.querySelectorAll("mark[data-excerpt]").forEach(mark => {
    if (marksMode === "none") {
      mark.classList.add("mark-hidden");
    } else if (marksMode === "mine" && userId) {
      const excId = mark.dataset.excerpt;
      const exc = state.excerpts[excId];
      const isMine = exc?.createdBy === userId;
      mark.classList.toggle("mark-hidden", !isMine);
    } else {
      mark.classList.remove("mark-hidden");
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
