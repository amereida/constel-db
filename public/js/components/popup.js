// popup.js — popup flotante para crear excerpts al seleccionar texto
// Los offsets se calculan buscando el texto seleccionado en el texto original,
// no mapeando posiciones DOM (que se desfasan con el HTML).

import { getRenderedSourceText } from "./text-highlighter.js";

/**
 * Inicializa el popup de creación de excerpts.
 * @param {Object} opts
 * @param {HTMLElement} opts.popup - elemento .excerpt-popup
 * @param {HTMLElement} opts.readerContent - contenedor del texto
 * @param {Function} opts.onCreateExcerpt - ({ text, start, end, conceptLabel }) => void
 */
export function initExcerptPopup({ popup, readerContent, onCreateExcerpt }) {
  const input = popup.querySelector("#conceptInput");
  const createBtn = popup.querySelector("#createExcerpt");
  const cancelBtn = popup.querySelector("#cancelExcerpt");

  let currentSelection = null;
  let tempHighlight = null;

  // escuchar selección de texto en el reader
  readerContent.addEventListener("mouseup", (e) => {
    setTimeout(() => handleSelection(e), 10);
  });

  function handleSelection(e) {
    const sel = window.getSelection();
    const text = sel?.toString().trim();

    if (!text || text.length < 3) {
      hide();
      return;
    }

    // calcular offsets buscando el texto en el string original
    const sourceText = getRenderedSourceText();
    const offsets = findInSourceText(sourceText, text, sel, readerContent);
    if (!offsets) { hide(); return; }

    currentSelection = {
      text,
      start: offsets.start,
      end: offsets.end,
    };

    // crear highlight temporal
    removeTempHighlight();
    const range = sel.getRangeAt(0);
    try {
      tempHighlight = document.createElement("mark");
      tempHighlight.className = "temp-highlight";
      range.surroundContents(tempHighlight);
    } catch {
      tempHighlight = null;
    }

    // posicionar popup
    const rect = (tempHighlight || range).getBoundingClientRect();
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
    popup.style.top = `${rect.bottom + 8}px`;
    popup.hidden = false;
    input.value = "";

    sel.removeAllRanges();
    input.focus();
  }

  /**
   * Encuentra la posición del texto seleccionado en el texto original.
   * Usa búsqueda por substring, contextualizando con la posición aproximada del DOM.
   */
  function findInSourceText(sourceText, selectedText, sel, container) {
    if (!sourceText || !selectedText) return null;

    // intentar búsqueda directa
    const idx = sourceText.indexOf(selectedText);
    if (idx !== -1) {
      // verificar que no hay otra ocurrencia (si hay, usar posición DOM para desambiguar)
      const secondIdx = sourceText.indexOf(selectedText, idx + 1);
      if (secondIdx === -1) {
        return { start: idx, end: idx + selectedText.length };
      }

      // múltiples ocurrencias: usar posición DOM aproximada para elegir la correcta
      const approxPos = estimateDomPosition(sel, container, sourceText.length);
      const candidates = [];
      let searchFrom = 0;
      while (true) {
        const found = sourceText.indexOf(selectedText, searchFrom);
        if (found === -1) break;
        candidates.push(found);
        searchFrom = found + 1;
      }

      // elegir la más cercana a la posición DOM estimada
      let best = candidates[0];
      let bestDist = Math.abs(best - approxPos);
      for (const c of candidates) {
        const dist = Math.abs(c - approxPos);
        if (dist < bestDist) { best = c; bestDist = dist; }
      }
      return { start: best, end: best + selectedText.length };
    }

    // no se encontró exacto — intentar con normalización de espacios
    const normalized = selectedText.replace(/\s+/g, " ");
    const normSource = sourceText.replace(/\s+/g, " ");
    const normIdx = normSource.indexOf(normalized);
    if (normIdx !== -1) {
      // mapear posición normalizada a posición original
      let origPos = 0, normPos = 0;
      while (normPos < normIdx && origPos < sourceText.length) {
        if (/\s/.test(sourceText[origPos])) {
          while (origPos < sourceText.length && /\s/.test(sourceText[origPos])) origPos++;
          normPos++;
        } else {
          origPos++;
          normPos++;
        }
      }
      return { start: origPos, end: Math.min(origPos + selectedText.length, sourceText.length) };
    }

    return null;
  }

  /**
   * Estima la posición aproximada en el texto original basándose en la posición
   * proporcional del scroll y la selección en el DOM.
   */
  function estimateDomPosition(sel, container, totalLength) {
    try {
      const range = sel.getRangeAt(0);
      const containerRect = container.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const relativeTop = rangeRect.top - containerRect.top + scrollTop;
      const ratio = relativeTop / scrollHeight;
      return Math.round(ratio * totalLength);
    } catch {
      return 0;
    }
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

  function hide() {
    removeTempHighlight();
    popup.hidden = true;
    currentSelection = null;
    input.value = "";
  }

  createBtn.addEventListener("click", () => {
    if (!currentSelection) return;
    const label = input.value.trim();
    if (!label) { input.focus(); return; }

    onCreateExcerpt({
      text: currentSelection.text,
      start: currentSelection.start,
      end: currentSelection.end,
      conceptLabel: label,
    });

    hide();
  });

  cancelBtn.addEventListener("click", () => {
    hide();
  });

  // Enter en el input → crear excerpt (solo si el autocomplete no está visible)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const dropdown = document.getElementById("autocompleteDropdown");
      if (dropdown && !dropdown.hidden) return; // dejar que el autocomplete maneje
      e.preventDefault();
      createBtn.click();
    }
  });

  // ESC para cerrar
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popup.hidden) hide();
  });

  return { hide };
}
