// text-highlighter.js — renderiza texto con marks de excerpts coloreados
// Usa white-space: pre-wrap para mantener mapeo 1:1 con el texto original.

import { state, getExcerptsForSource, removeExcerpt, removeConceptFromExcerpt } from "../state.js";

// Guardamos referencia al texto original para calcular offsets
let _sourceText = "";

// Tooltip singleton
let _tooltip = null;
let _tooltipTimeout = null;

/**
 * Retorna el texto original del source actualmente renderizado.
 */
export function getRenderedSourceText() {
  return _sourceText;
}

/**
 * Renderiza el texto de un source con highlights de excerpts.
 * @param {HTMLElement} container
 * @param {string} text - texto completo del source
 * @param {string} sourceId
 * @param {Function} onExcerptClick - (excerptId) => void
 */
export function renderHighlightedText(container, text, sourceId, onExcerptClick) {
  _sourceText = text;
  const excerpts = getExcerptsForSource(sourceId);

  if (!excerpts.length) {
    container.textContent = text;
    return;
  }

  // ordenar excerpts por posición de inicio, sin solapamientos
  const sorted = excerpts
    .filter(e => typeof e.start === "number" && typeof e.end === "number")
    .sort((a, b) => a.start - b.start);

  // construir HTML insertando <mark> en las posiciones correctas del texto original
  const parts = [];
  let cursor = 0;

  for (const exc of sorted) {
    // evitar solapamientos
    const start = Math.max(exc.start, cursor);
    if (start >= exc.end) continue;

    // texto antes del excerpt
    if (start > cursor) {
      parts.push(escapeHtml(text.slice(cursor, start)));
    }

    const color = getExcerptColor(exc);
    const conceptLabels = exc.conceptIds
      .map(cid => state.concepts[cid]?.label)
      .filter(Boolean)
      .join(", ");

    parts.push(
      `<mark data-excerpt="${exc.id}" data-concepts="${escapeAttr(conceptLabels)}" style="--mark-color: ${color}; border-bottom-color: ${color}; background: ${color}20">`
    );
    parts.push(escapeHtml(text.slice(start, exc.end)));
    parts.push("</mark>");

    cursor = exc.end;
  }

  // texto restante
  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)));
  }

  container.innerHTML = parts.join("");

  // event listeners en marks
  container.querySelectorAll("mark[data-excerpt]").forEach(mark => {
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      onExcerptClick(mark.dataset.excerpt);
    });

    mark.addEventListener("mouseenter", (e) => {
      clearTimeout(_tooltipTimeout);
      showExcerptTooltip(mark, onExcerptClick);
    });

    mark.addEventListener("mouseleave", () => {
      _tooltipTimeout = setTimeout(hideExcerptTooltip, 250);
    });
  });
}

/**
 * Muestra tooltip contextual sobre un excerpt.
 */
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
      <button class="tooltip-btn tooltip-delete" data-action="delete" title="Eliminar sección">${trashSvg}</button>
    </div>
    <div class="tooltip-confirm" style="display:none">
      <span class="tooltip-confirm-msg">¿Eliminar sección?</span>
      <button class="tooltip-confirm-yes">Eliminar</button>
      <button class="tooltip-confirm-no">No</button>
    </div>
  `;

  // posicionar
  const rect = mark.getBoundingClientRect();
  _tooltip.style.display = "flex";
  _tooltip.classList.remove("confirming");

  // medir tooltip
  const tooltipRect = _tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - 6;

  // si no cabe arriba, ponerlo abajo
  if (top < 4) {
    top = rect.bottom + 6;
  }
  // mantener dentro de la ventana
  left = Math.max(4, Math.min(window.innerWidth - tooltipRect.width - 4, left));

  _tooltip.style.left = left + "px";
  _tooltip.style.top = top + "px";

  // acciones: mostrar confirmación
  _tooltip.querySelector('[data-action="delete"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    _tooltip.classList.add("confirming");
    _tooltip.querySelector(".tooltip-confirm").style.display = "flex";
  });

  // confirmar eliminación
  _tooltip.querySelector(".tooltip-confirm-yes")?.addEventListener("click", (e) => {
    e.stopPropagation();
    removeExcerpt(excId);
    hideExcerptTooltip();
  });

  // cancelar
  _tooltip.querySelector(".tooltip-confirm-no")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _tooltip.classList.remove("confirming");
    _tooltip.querySelector(".tooltip-confirm").style.display = "none";
  });

  // click en un chip de concepto → abrir detalle en sidebar
  _tooltip.querySelectorAll(".tooltip-concept").forEach((chip, i) => {
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

/**
 * Obtiene el color dominante de un excerpt basado en sus concepts/themes.
 */
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

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Scroll al excerpt indicado en el contenedor, con feedback visual.
 */
export function scrollToExcerpt(container, excerptId) {
  const mark = container.querySelector(`mark[data-excerpt="${excerptId}"]`);
  if (mark) {
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.classList.add("highlight-active");
    setTimeout(() => mark.classList.remove("highlight-active"), 2000);
  }
}
