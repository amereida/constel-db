// popup.js — popup flotante para crear excerpts al seleccionar texto
// El texto seleccionado se busca en el markdown source raw para insertar milestones.

import { getCurrentSourceRaw } from "./text-highlighter.js";

/**
 * Inicializa el popup de creacion de excerpts.
 * @param {Object} opts
 * @param {HTMLElement} opts.popup - elemento .excerpt-popup
 * @param {HTMLElement} opts.readerContent - contenedor del texto
 * @param {Function} opts.onCreateExcerpt - ({ text, conceptLabel }) => void
 */
export function initExcerptPopup({ popup, readerContent, onCreateExcerpt }) {
  const input = popup.querySelector("#conceptInput");
  const createBtn = popup.querySelector("#createExcerpt");
  const cancelBtn = popup.querySelector("#cancelExcerpt");

  let currentSelection = null;
  let tempHighlight = null;

  // escuchar seleccion de texto en el reader
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

    // Verify the text exists in the source (strip milestones for clean search)
    const sourceRaw = getCurrentSourceRaw();
    const cleanSource = sourceRaw.replace(/<!-- §[be] \S+ -->/g, "");
    if (!findInSource(cleanSource, text, sel, readerContent)) {
      hide();
      return;
    }

    currentSelection = { text };

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
   * Verifica que el texto seleccionado existe en el source.
   */
  function findInSource(cleanSource, selectedText, sel, container) {
    if (!cleanSource || !selectedText) return false;

    // busqueda directa
    const idx = cleanSource.indexOf(selectedText);
    if (idx !== -1) return true;

    // intentar con normalizacion de espacios
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

    const selectedText = currentSelection.text;

    // Keep the highlight visible with a saving animation
    if (tempHighlight) {
      tempHighlight.classList.remove("temp-highlight");
      tempHighlight.classList.add("saving-highlight");
    }

    // Hide popup but DON'T remove the highlight — it stays until re-render
    popup.hidden = true;
    tempHighlight = null; // detach so hide() won't remove it later
    currentSelection = null;
    input.value = "";

    onCreateExcerpt({
      text: selectedText,
      conceptLabel: label,
    });
  });

  cancelBtn.addEventListener("click", () => {
    hide();
  });

  // Enter en el input -> crear excerpt (solo si el autocomplete no esta visible)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const dropdown = document.getElementById("autocompleteDropdown");
      if (dropdown && !dropdown.hidden) return;
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
