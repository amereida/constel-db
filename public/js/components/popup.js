// popup.js — detecta seleccion de texto y notifica al reader
// Ya no muestra un popup propio; delega al popover unificado de reader.js

import { getCurrentSourceRaw } from "./text-highlighter.js";

/**
 * Inicializa la deteccion de seleccion de texto para crear excerpts.
 * @param {Object} opts
 * @param {HTMLElement} opts.readerContent - contenedor del texto
 * @param {Function} opts.onSelection - ({ text, anchorEl }) => void
 */
export function initExcerptPopup({ readerContent, onSelection }) {
  let tempHighlight = null;

  readerContent.addEventListener("mouseup", (e) => {
    // Don't intercept clicks on existing marks (those open the view popover)
    if (e.target.closest("mark[data-excerpt]")) return;
    setTimeout(() => handleSelection(e), 10);
  });

  function handleSelection(e) {
    const sel = window.getSelection();
    const text = sel?.toString().trim();

    if (!text || text.length < 3) {
      cleanup();
      return;
    }

    // Verify the text exists in the source
    const sourceRaw = getCurrentSourceRaw();
    const cleanSource = sourceRaw.replace(/<!-- §[be] \S+ -->/g, "");
    if (!findInSource(cleanSource, text)) {
      cleanup();
      return;
    }

    // Capture the range rect BEFORE any DOM manipulation
    removeTempHighlight();
    const range = sel.getRangeAt(0);
    const rangeRect = range.getBoundingClientRect();

    // Try to create a visual highlight
    try {
      tempHighlight = document.createElement("mark");
      tempHighlight.className = "temp-highlight";
      range.surroundContents(tempHighlight);
    } catch {
      tempHighlight = null;
    }

    sel.removeAllRanges();

    // Pass the rect for positioning (always accurate, unlike anchor elements)
    onSelection({
      text,
      anchorEl: tempHighlight || readerContent,
      rect: rangeRect,
    });
  }

  function findInSource(cleanSource, selectedText) {
    if (!cleanSource || !selectedText) return false;
    if (cleanSource.indexOf(selectedText) !== -1) return true;
    const normalized = selectedText.replace(/\s+/g, " ");
    const normSource = cleanSource.replace(/\s+/g, " ");
    return normSource.indexOf(normalized) !== -1;
  }

  function removeTempHighlight() {
    if (tempHighlight && tempHighlight.parentNode) {
      const parent = tempHighlight.parentNode;
      while (tempHighlight.firstChild) {
        parent.insertBefore(tempHighlight.firstChild, tempHighlight);
      }
      parent.removeChild(tempHighlight);
      parent.normalize();
      tempHighlight = null;
    }
  }

  function cleanup() {
    removeTempHighlight();
  }

  /**
   * Called after excerpt is created — keep the highlight visible
   * with a saving animation until re-render replaces it.
   */
  function detachHighlight() {
    if (tempHighlight) {
      tempHighlight.classList.remove("temp-highlight");
      tempHighlight.classList.add("saving-highlight");
      tempHighlight = null; // detach so cleanup won't remove it
    }
  }

  return { cleanup, detachHighlight, removeTempHighlight };
}
