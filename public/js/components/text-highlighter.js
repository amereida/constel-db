// text-highlighter.js — renderiza Markdown como HTML con milestones de excerpts
// Pipeline: Markdown source (con <!-- §b/§e --> milestones) → marked → HTML con <mark>

import { state, getExcerptsForSource, removeExcerpt } from "../state.js";
import { marked } from "../lib/marked.esm.js";

// ── Configure marked ─────────────────────────────────────────────────────

marked.setOptions({
  breaks: true,      // line breaks → <br>
  gfm: true,
  headerIds: false,
});

/**
 * Preprocess source text before marked.parse():
 * - Replace leading spaces (4+) with non-breaking spaces to prevent
 *   markdown's "indented code block" detection. Literary texts use
 *   indentation for poetry, not for code.
 */
function preprocessSource(source) {
  // 1. Convert ```poem...``` pairs to :::poem...::: so marked's fences
  //    tokenizer ignores them. Our poemBlock extension handles :::poem.
  let result = source.replace(/^```poem\n([\s\S]*?)\n```/gm, (match, inner) => {
    return `:::poem\n${inner}\n:::`;
  });
  // 2. Replace leading 4+ spaces with nbsp to prevent indented code blocks
  result = result.replace(/^( {4,})/gm, (m) => "\u00A0".repeat(m.length));
  return result;
}

// ── Milestone extensions ─────────────────────────────────────────────────
// Milestones in the markdown source: <!-- §b excerpt_id --> ... <!-- §e excerpt_id -->
// These are parsed as inline tokens and rendered as <mark> open/close tags.

// ```poem blocks MUST be registered first so they take priority over
// marked's built-in fences tokenizer for ```poem specifically.
marked.use({
  extensions: [
    {
      name: "poemBlock",
      level: "block",
      start(src) {
        return src.match(/^:::poem/m)?.index;
      },
      tokenizer(src) {
        const match = src.match(/^:::poem\n([\s\S]*?)\n:::/);
        if (match) {
          const token = {
            type: "poemBlock",
            raw: match[0],
            text: match[1],
            tokens: [],
          };
          this.lexer.inlineTokens(token.text, token.tokens);
          return token;
        }
      },
      renderer(token) {
        return `<div class="poem">${this.parser.parseInline(token.tokens)}</div>`;
      },
    },
  ],
});

marked.use({
  extensions: [
    {
      name: "milestoneBegin",
      level: "inline",
      start(src) {
        return src.indexOf("<!-- §b ");
      },
      tokenizer(src) {
        const match = src.match(/^<!-- §b (\S+) -->/);
        if (match) {
          return {
            type: "milestoneBegin",
            raw: match[0],
            id: match[1],
          };
        }
      },
      renderer(token) {
        const exc = state.excerpts[token.id];
        const color = exc ? getExcerptColor(exc) : null;
        const labels = exc
          ? exc.conceptIds.map(cid => state.concepts[cid]?.label).filter(Boolean).join(", ")
          : "";
        // If color is a hex value, append alpha. Otherwise use CSS color-mix for var() colors.
        let bg;
        if (color && color.startsWith("#")) {
          bg = `${color}26`;
        } else {
          bg = `color-mix(in srgb, var(--accent) 15%, transparent)`;
        }
        return `<mark data-excerpt="${escapeHtml(token.id)}" data-concepts="${escapeHtml(labels)}" style="--mark-color:${color || "var(--accent)"};background:${bg}">`;
      },
    },
    {
      name: "milestoneEnd",
      level: "inline",
      start(src) {
        return src.indexOf("<!-- §e ");
      },
      tokenizer(src) {
        const match = src.match(/^<!-- §e (\S+) -->/);
        if (match) {
          return {
            type: "milestoneEnd",
            raw: match[0],
            id: match[1],
          };
        }
      },
      renderer() {
        return "</mark>";
      },
    },
  ],
});

// ── Tooltip singleton ────────────────────────────────────────────────────

let _tooltip = null;
let _tooltipTimeout = null;

// ── Current source raw text (for popup offset search) ────────────────────

let _currentSourceRaw = "";

/**
 * Returns the raw markdown source of the currently rendered text.
 * Used by popup.js to find selected text in the source for milestone insertion.
 */
export function getCurrentSourceRaw() {
  return _currentSourceRaw;
}

/**
 * Render a source with Markdown + milestones → HTML with <mark> elements.
 * @param {HTMLElement} container
 * @param {string} source - raw markdown content (with milestone comments)
 * @param {string} sourceId
 * @param {Function} onExcerptClick - (excerptId) => void
 */
export function renderHighlightedText(container, source, sourceId, onExcerptClick) {
  _currentSourceRaw = source;

  // Preprocess to prevent indented code blocks, then parse
  const html = marked.parse(preprocessSource(source));
  container.innerHTML = html;
  container.classList.add("rendered-markdown");

  // Attach event listeners to all marks
  attachMarkListeners(container, onExcerptClick);
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

// ── Milestone helpers (exported for use by other modules) ────────────────

/**
 * Insert milestone comments around a text range in the markdown source.
 * @param {string} source - raw markdown
 * @param {string} selectedText - the text to wrap
 * @param {string} excerptId - the excerpt ID for the milestones
 * @returns {string|null} - updated source, or null if text not found
 */
export function insertMilestones(source, selectedText, excerptId) {
  // Strip existing milestones for clean search
  const cleanSource = source.replace(/<!-- §[be] \S+ -->/g, "");

  // Build a set of real fenced code block ranges (positions to avoid).
  // Exclude ```poem blocks since those support milestones.
  const fencedRanges = [];
  const fencedRe = /^(`{3,})([^\n]*)\n[\s\S]*?\n\1/gm;
  let fm;
  while ((fm = fencedRe.exec(cleanSource)) !== null) {
    const lang = fm[2].trim();
    if (lang === "poem") continue; // poem blocks are markable
    fencedRanges.push({ start: fm.index, end: fm.index + fm[0].length });
  }

  function isInsideFenced(pos) {
    return fencedRanges.some(r => pos >= r.start && pos < r.end);
  }

  // Find the text, skipping matches inside fenced blocks
  let searchFrom = 0;
  let idx = -1;
  while (true) {
    idx = cleanSource.indexOf(selectedText, searchFrom);
    if (idx === -1) return null;
    if (!isInsideFenced(idx)) break; // found outside fenced block
    searchFrom = idx + 1;
  }

  // Map clean index back to original source position
  const milestoneRe = /<!-- §[be] \S+ -->/g;
  let match;
  const milestones = [];
  while ((match = milestoneRe.exec(source)) !== null) {
    milestones.push({ start: match.index, len: match[0].length });
  }

  let ci = 0; // clean index
  let oi = 0; // original index
  let mi = 0; // milestone index
  let startOrig = -1;
  let endOrig = -1;

  while (oi < source.length && ci <= idx + selectedText.length) {
    if (mi < milestones.length && oi === milestones[mi].start) {
      oi += milestones[mi].len;
      mi++;
      continue;
    }

    if (ci === idx) startOrig = oi;
    if (ci === idx + selectedText.length) {
      endOrig = oi;
      break;
    }

    ci++;
    oi++;
  }

  if (startOrig === -1) return null;
  if (endOrig === -1) endOrig = oi;

  const before = source.slice(0, startOrig);
  const text = source.slice(startOrig, endOrig);
  const after = source.slice(endOrig);

  return `${before}<!-- §b ${excerptId} -->${text}<!-- §e ${excerptId} -->${after}`;
}

/**
 * Remove milestone comments for a given excerpt ID from the source.
 * @param {string} source - raw markdown with milestones
 * @param {string} excerptId - the excerpt ID to remove
 * @returns {string} - cleaned source
 */
export function removeMilestones(source, excerptId) {
  const escaped = excerptId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source
    .replace(new RegExp(`<!-- §b ${escaped} -->`, "g"), "")
    .replace(new RegExp(`<!-- §e ${escaped} -->`, "g"), "");
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
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
