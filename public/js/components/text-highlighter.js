// text-highlighter.js — renderiza Markdown como HTML con milestones de excerpts
// Pipeline: Markdown source (con <!-- §b/§e --> milestones) → marked → HTML con <mark>

import { state, getExcerptsForSource } from "../state.js";
import { marked } from "../lib/marked.esm.js";
import markedFootnote from "../lib/marked-footnote.esm.js";

// ── Smart quotes ────────────────────────────────────────────────────────
// Replace dumb quotes with typographic quotes in rendered HTML.
// Only processes text outside of HTML tags to avoid breaking attributes.

function smartQuotes(html) {
  // First decode &quot; and &#39; to literal quotes so regex can process them
  html = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  return html.replace(/>([^<]+)</g, (match, text) => {
    const fixed = text
      // Double quotes
      .replace(/(\s|^)"(\S)/g, '$1\u201C$2')   // after space/start → open
      .replace(/(\S)"(\s|[.,;:!?\)]|$)/g, '$1\u201D$2') // before space/punct/end → close
      .replace(/"/g, '\u201D')                  // remaining → close
      // Single quotes / apostrophes
      .replace(/(\s|^)'(\S)/g, '$1\u2018$2')   // after space/start → open
      .replace(/(\S)'(\s|[.,;:!?\)]|$)/g, '$1\u2019$2') // before space/punct/end → close
      .replace(/(\w)'(\w)/g, '$1\u2019$2')     // within word (it's, l'eau) → apostrophe
      .replace(/'/g, '\u2019')                  // remaining → close
      // Dashes: -- → em dash, ... → ellipsis
      .replace(/---/g, '\u2014')               // --- → em dash
      .replace(/--/g, '\u2014')                // -- → em dash
      .replace(/\.\.\./g, '\u2026');           // ... → ellipsis
    return `>${fixed}<`;
  });
}

// ── Configure marked ─────────────────────────────────────────────────────

marked.setOptions({
  breaks: true,      // line breaks → <br>
  gfm: true,
  headerIds: false,
});

// Footnotes → rendered as <section class="footnotes"> by marked-footnote
marked.use(markedFootnote({ prefixId: "fn-" }));

/**
 * Preprocess source text before marked.parse():
 * - Replace leading spaces (4+) with non-breaking spaces to prevent
 *   markdown's "indented code block" detection. Literary texts use
 *   indentation for poetry, not for code.
 */
function preprocessSource(source) {
  // 1. Convert milestones to <mark> HTML BEFORE marked parses.
  //    This ensures marks work inside blockquotes, lists, headers, etc.
  let result = source.replace(/<!-- §b (\S+) -->/g, (_, id) => {
    const exc = state.excerpts[id];
    const labels = exc
      ? (exc.conceptIds.map(cid => state.concepts[cid]?.label).filter(Boolean).join(", ") || "sin concepto")
      : "";
    const color = exc ? getExcerptColor(exc) : null;
    let bg;
    if (color && color.startsWith("#")) {
      bg = `${color}40`;
    } else {
      bg = `color-mix(in srgb, var(--accent) 25%, transparent)`;
    }
    return `<mark data-excerpt="${escapeHtml(id)}" data-concepts="${escapeHtml(labels)}" style="--mark-color:${color || "var(--accent)"};background:${bg}">`;
  });
  result = result.replace(/<!-- §e (\S+) -->/g, "</mark>");

  // 2. Convert ```poem...``` pairs to :::poem...::: so marked's fences
  //    tokenizer ignores them. Our poemBlock extension handles :::poem.
  result = result.replace(/^```poem\n([\s\S]*?)\n```/gm, (match, inner) => {
    return `:::poem\n${inner}\n:::`;
  });

  // 3. Replace leading 4+ spaces with nbsp to prevent indented code blocks
  result = result.replace(/^( {4,})/gm, (m) => "\u00A0".repeat(m.length));
  return result;
}

// ── Poem block extension ─────────────────────────────────────────────────
// :::poem...::: blocks (converted from ```poem by preprocessSource) are
// rendered as <div class="poem"> with inline markdown parsed inside.
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
  const html = smartQuotes(marked.parse(preprocessSource(source)));
  container.innerHTML = html;
  container.classList.add("rendered-markdown");

  // Convert footnotes to sidenotes
  convertFootnotesToSidenotes(container);

  // Intercept footnote reference clicks — highlight sidenote instead of navigating
  container.querySelectorAll('a[data-fn-ref]').forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const fnId = link.getAttribute("href")?.slice(1); // "fn-1"
      if (!fnId) return;
      const sidenote = document.querySelector(`.sidenote[data-fn-id="${fnId}"]`);
      if (sidenote) {
        sidenote.classList.add("sidenote-highlight");
        sidenote.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setTimeout(() => sidenote.classList.remove("sidenote-highlight"), 2000);
      }
    });
  });

  // Attach event listeners to all marks
  attachMarkListeners(container, onExcerptClick);
}

// ── Sidenotes ────────────────────────────────────────────────────────────

/**
 * Convert marked-footnote's <section class="footnotes"> into sidenotes
 * in the right column. Each note is positioned at the vertical offset
 * of its <sup> reference in the text.
 */
function convertFootnotesToSidenotes(container) {
  const sidenotesCol = document.getElementById("readerSidenotes");
  if (sidenotesCol) sidenotesCol.innerHTML = "";

  const footnotesSection = container.querySelector("section.footnotes");
  if (!footnotesSection || !sidenotesCol) return;

  const items = footnotesSection.querySelectorAll("li[id]");
  const sidenotes = [];

  items.forEach((li, i) => {
    const fnId = li.id; // e.g. "fn-1"
    const refId = fnId.replace("fn-", "fn-ref-"); // e.g. "fn-ref-1"
    const refEl = container.querySelector(`#${CSS.escape(refId)}`);

    // Get the content of the footnote (strip the backref link)
    const backref = li.querySelector("a[data-fn-backref]");
    if (backref) backref.remove();
    const noteContent = li.innerHTML.trim()
      .replace(/^<p>/, "").replace(/<\/p>$/, ""); // unwrap single <p>

    // Create sidenote element
    const aside = document.createElement("aside");
    aside.className = "sidenote";
    aside.dataset.fnId = fnId;
    aside.innerHTML = `<span class="sidenote-number">${i + 1}</span> ${noteContent}`;

    sidenotesCol.appendChild(aside);
    sidenotes.push({ aside, refEl });
  });

  // Remove the original footnotes section
  footnotesSection.remove();

  // Position sidenotes after DOM is settled
  requestAnimationFrame(() => {
    positionSidenotes(container, sidenotesCol, sidenotes);
    setupSidenoteScrollHandler(container, sidenotesCol);
  });
}

/**
 * Position each sidenote at the vertical offset of its reference <sup>.
 * Prevents overlap by pushing notes down if they collide.
 */
function positionSidenotes(container, sidenotesCol, sidenotes) {
  // Both container (text) and sidenotesCol share the same scrollable parent
  const scrollParent = container.closest(".reader-text-panel");
  if (!scrollParent) return;

  const colRect = sidenotesCol.getBoundingClientRect();
  let lastBottom = 0;

  for (const { aside, refEl } of sidenotes) {
    if (!refEl) continue;

    // Position relative to the sidenotes column top
    const refRect = refEl.getBoundingClientRect();
    let top = refRect.top - colRect.top;

    // Prevent overlap with previous sidenote
    if (top < lastBottom + 8) {
      top = lastBottom + 8;
    }

    aside.style.top = `${top}px`;
    lastBottom = top + aside.offsetHeight;
  }
}

/**
 * Reposition sidenotes on scroll (refs move relative to viewport).
 */
function setupSidenoteScrollHandler(container, sidenotesCol) {
  const scrollParent = container.closest(".reader-text-panel");
  if (!scrollParent) return;

  // Collect sidenote/ref pairs from DOM
  const sidenotes = [];
  sidenotesCol.querySelectorAll(".sidenote").forEach(aside => {
    const fnId = aside.dataset.fnId;
    const refId = fnId.replace("fn-", "fn-ref-");
    const refEl = container.querySelector(`#${CSS.escape(refId)}`);
    sidenotes.push({ aside, refEl });
  });

  if (!sidenotes.length) return;

  // Reposition on scroll with throttle
  let ticking = false;
  scrollParent.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      positionSidenotes(container, sidenotesCol, sidenotes);
      ticking = false;
    });
  });
}

// ── Mark event listeners ──────────────────────────────────────────────────

function attachMarkListeners(container, onExcerptClick) {
  container.querySelectorAll("mark[data-excerpt]").forEach(mark => {
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      onExcerptClick(mark.dataset.excerpt, mark);
    });
  });
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
 * Falls back to text search if no milestone <mark> exists.
 */
export function scrollToExcerpt(container, excerptId) {
  // Try milestone-based mark first
  let mark = container.querySelector(`mark[data-excerpt="${excerptId}"]`);

  // Fallback: find by excerpt text in the DOM
  if (!mark) {
    const exc = Object.values(state.excerpts).find(e => e.id === excerptId);
    if (exc?.text) {
      const needle = exc.text.slice(0, 60).trim();
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(needle)) {
          // Wrap in a temporary highlight
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          const span = document.createElement("span");
          span.className = "highlight-active";
          range.surroundContents(span);
          mark = span;
          setTimeout(() => {
            span.replaceWith(...span.childNodes);
          }, 2500);
          break;
        }
      }
    }
  }

  if (mark) {
    // Scroll within the reader-text-panel container
    const scroller = mark.closest(".reader-text-panel") || container;
    const markRect = mark.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const offset = markRect.top - scrollerRect.top + scroller.scrollTop - (scroller.clientHeight / 2);
    scroller.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });

    mark.classList.add("highlight-active");
    setTimeout(() => mark.classList.remove("highlight-active"), 2000);
  }
}
