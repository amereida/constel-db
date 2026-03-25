// text-highlighter.js — renderiza Markdown como HTML con marks de excerpts
// Pipeline: Markdown source → marked → HTML → inject marks via DOM text nodes

import { state, getExcerptsForSource, removeExcerpt } from "../state.js";
import { marked } from "../lib/marked.esm.js";

// Configure marked for literary texts
marked.setOptions({
  breaks: true,      // line breaks → <br>
  gfm: true,
  headerIds: false,
});

// Plain text extracted from rendered HTML (for offset calculations)
let _plainText = "";

// Tooltip singleton
let _tooltip = null;
let _tooltipTimeout = null;

/**
 * Returns the plain text of the currently rendered source.
 * Offsets are calculated against this string.
 */
export function getRenderedSourceText() {
  return _plainText;
}

/**
 * Render a source with Markdown → HTML + excerpt highlights.
 * @param {HTMLElement} container
 * @param {string} source - raw content (Markdown or plain text)
 * @param {string} sourceId
 * @param {Function} onExcerptClick - (excerptId) => void
 */
export function renderHighlightedText(container, source, sourceId, onExcerptClick) {
  // 1. Render Markdown → HTML
  const html = marked.parse(source);
  container.innerHTML = html;
  container.classList.add("rendered-markdown");

  // 2. Extract plain text from rendered HTML (this is our offset reference)
  _plainText = extractPlainText(container);

  // 3. Get and sort excerpts
  const excerpts = getExcerptsForSource(sourceId)
    .filter(e => typeof e.start === "number" && typeof e.end === "number")
    .sort((a, b) => a.start - b.start);

  if (!excerpts.length) return;

  // 4. Build text-node map: array of { node, startOffset, endOffset }
  const textMap = buildTextNodeMap(container);

  // 5. Insert marks by wrapping text node ranges
  for (const exc of excerpts) {
    const color = getExcerptColor(exc);
    const conceptLabels = exc.conceptIds
      .map(cid => state.concepts[cid]?.label)
      .filter(Boolean)
      .join(", ");

    wrapRange(textMap, exc.start, exc.end, exc.id, color, conceptLabels);
  }

  // 6. Attach event listeners to marks
  attachMarkListeners(container, onExcerptClick);
}

// ── Text node mapping ─────────────────────────────────────────────────────

/**
 * Extract plain text from a container, matching how we count offsets.
 * Adds newlines for block elements to keep text positions meaningful.
 */
function extractPlainText(container) {
  let text = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    text += walker.currentNode.textContent;
  }
  return text;
}

/**
 * Build a map of text nodes with their character offset ranges.
 * Returns [{ node, start, end }] where start/end are char offsets in plain text.
 */
function buildTextNodeMap(container) {
  const map = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent.length;
    map.push({ node, start: offset, end: offset + len });
    offset += len;
  }
  return map;
}

/**
 * Wrap a character range [start, end) in <mark> elements across text nodes.
 * Handles ranges that span multiple text nodes by splitting and wrapping each.
 */
function wrapRange(textMap, start, end, excerptId, color, conceptLabels) {
  // Find all text nodes that overlap with [start, end)
  for (let i = 0; i < textMap.length; i++) {
    const entry = textMap[i];
    if (entry.end <= start || entry.start >= end) continue;

    const node = entry.node;
    const nodeStart = entry.start;
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(node.textContent.length, end - nodeStart);

    if (localStart >= localEnd) continue;

    // Split the text node if needed
    // Before | Marked | After
    const parent = node.parentNode;
    if (!parent) continue;

    // Don't nest marks inside marks
    if (parent.closest && parent.closest("mark[data-excerpt]")) continue;

    const fullText = node.textContent;

    // Create fragments
    const before = fullText.slice(0, localStart);
    const marked_text = fullText.slice(localStart, localEnd);
    const after = fullText.slice(localEnd);

    // Build new nodes
    const frag = document.createDocumentFragment();

    if (before) {
      const beforeNode = document.createTextNode(before);
      frag.appendChild(beforeNode);
    }

    const mark = document.createElement("mark");
    mark.dataset.excerpt = excerptId;
    mark.dataset.concepts = conceptLabels;
    mark.style.setProperty("--mark-color", color);
    mark.style.borderBottomColor = color;
    mark.style.background = color + "20";
    mark.textContent = marked_text;
    frag.appendChild(mark);

    if (after) {
      const afterNode = document.createTextNode(after);
      frag.appendChild(afterNode);
    }

    parent.replaceChild(frag, node);

    // Update the textMap for subsequent excerpts
    // Remove old entry and insert new ones
    const newEntries = [];
    let pos = nodeStart;
    if (before) {
      // find the before text node (first child we inserted)
      newEntries.push({ node: mark.previousSibling || frag.firstChild, start: pos, end: pos + before.length });
      pos += before.length;
    }
    // the mark's text node
    newEntries.push({ node: mark.firstChild, start: pos, end: pos + marked_text.length });
    pos += marked_text.length;
    if (after) {
      newEntries.push({ node: mark.nextSibling, start: pos, end: pos + after.length });
    }

    textMap.splice(i, 1, ...newEntries);
    // Adjust loop index since we inserted entries
    i += newEntries.length - 1;
  }
}

// ── Mark event listeners ──────────────────────────────────────────────────

function attachMarkListeners(container, onExcerptClick) {
  container.querySelectorAll("mark[data-excerpt]").forEach(mark => {
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      onExcerptClick(mark.dataset.excerpt);
    });

    mark.addEventListener("mouseenter", () => {
      clearTimeout(_tooltipTimeout);
      showExcerptTooltip(mark, onExcerptClick);
    });

    mark.addEventListener("mouseleave", () => {
      _tooltipTimeout = setTimeout(hideExcerptTooltip, 250);
    });
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────────

function showExcerptTooltip(mark, onExcerptClick) {
  const excId = mark.dataset.excerpt;
  const exc = state.excerpts[excId];
  if (!exc) return;

  if (!_tooltip) {
    _tooltip = document.createElement("div");
    _tooltip.className = "excerpt-tooltip";
    document.body.appendChild(_tooltip);

    _tooltip.addEventListener("mouseenter", () => {
      clearTimeout(_tooltipTimeout);
    });
    _tooltip.addEventListener("mouseleave", () => {
      _tooltipTimeout = setTimeout(hideExcerptTooltip, 200);
    });
  }

  const concepts = exc.conceptIds
    .map(cid => state.concepts[cid])
    .filter(Boolean);

  const conceptChips = concepts.map(c =>
    `<span class="tooltip-concept">${escapeHtml(c.label)}</span>`
  ).join(" ");

  const trashSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

  _tooltip.innerHTML = `
    <div class="tooltip-concepts">${conceptChips}</div>
    <div class="tooltip-actions">
      <button class="tooltip-btn tooltip-delete" data-action="delete" title="Eliminar seccion">${trashSvg}</button>
    </div>
    <div class="tooltip-confirm" style="display:none">
      <span class="tooltip-confirm-msg">Eliminar seccion?</span>
      <button class="tooltip-confirm-yes">Eliminar</button>
      <button class="tooltip-confirm-no">No</button>
    </div>
  `;

  // posicionar
  const rect = mark.getBoundingClientRect();
  _tooltip.style.display = "flex";
  _tooltip.classList.remove("confirming");

  const tooltipRect = _tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - 6;

  if (top < 4) top = rect.bottom + 6;
  left = Math.max(4, Math.min(window.innerWidth - tooltipRect.width - 4, left));

  _tooltip.style.left = left + "px";
  _tooltip.style.top = top + "px";

  _tooltip.querySelector('[data-action="delete"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    _tooltip.classList.add("confirming");
    _tooltip.querySelector(".tooltip-confirm").style.display = "flex";
  });

  _tooltip.querySelector(".tooltip-confirm-yes")?.addEventListener("click", (e) => {
    e.stopPropagation();
    removeExcerpt(excId);
    hideExcerptTooltip();
  });

  _tooltip.querySelector(".tooltip-confirm-no")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _tooltip.classList.remove("confirming");
    _tooltip.querySelector(".tooltip-confirm").style.display = "none";
  });

  _tooltip.querySelectorAll(".tooltip-concept").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      onExcerptClick(excId);
      hideExcerptTooltip();
    });
  });
}

function hideExcerptTooltip() {
  if (_tooltip) {
    _tooltip.style.display = "none";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getExcerptColor(excerpt) {
  for (const cid of excerpt.conceptIds) {
    const concept = state.concepts[cid];
    if (concept?.themeId && state.themes[concept.themeId]) {
      return state.themes[concept.themeId].color;
    }
  }
  return "var(--accent)";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Scroll to an excerpt mark with visual feedback.
 */
export function scrollToExcerpt(container, excerptId) {
  const mark = container.querySelector(`mark[data-excerpt="${excerptId}"]`);
  if (mark) {
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.classList.add("highlight-active");
    setTimeout(() => mark.classList.remove("highlight-active"), 2000);
  }
}
