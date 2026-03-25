// minimap.js — barra vertical de densidad tipo Wattenberg
// Muestra el texto como barra vertical 100% de alto con bandas de color por excerpts.

import { state, getExcerptsForSource } from "../state.js";

/**
 * Renderiza el minimap vertical para un source.
 * @param {HTMLElement} container - .reader-minimap-strip
 * @param {string} sourceId
 * @param {number} textLength - largo del texto en caracteres
 * @param {HTMLElement} readerContent - para sincronizar scroll
 */
export function renderMinimap(container, sourceId, textLength, readerContent) {
  if (!textLength) {
    container.innerHTML = "";
    return;
  }

  const excerpts = getExcerptsForSource(sourceId);

  // calcular % marcado
  const markedChars = new Set();
  for (const exc of excerpts) {
    if (typeof exc.start === "number" && typeof exc.end === "number") {
      for (let i = exc.start; i < exc.end && i < textLength; i++) {
        markedChars.add(i);
      }
    }
  }
  const pct = textLength > 0 ? Math.round((markedChars.size / textLength) * 100) : 0;

  // construir HTML — el minimap ocupa todo el container (100% alto)
  container.innerHTML = `
    <div class="minimap">
      ${excerpts.map(exc => {
        const top = (exc.start / textLength) * 100;
        const height = Math.max(0.3, ((exc.end - exc.start) / textLength) * 100);
        const color = getExcerptColor(exc);
        return `<div class="minimap-band" style="top:${top}%;height:${height}%;background:${color}"></div>`;
      }).join("")}
      <div class="minimap-viewport" id="minimapViewport"></div>
    </div>
    <div class="minimap-stats">
      <span>${excerpts.length}§</span>
      <span>${pct}%</span>
    </div>
  `;

  // sincronizar viewport con scroll del texto
  const viewport = container.querySelector("#minimapViewport");
  const minimap = container.querySelector(".minimap");

  function updateViewport() {
    if (!readerContent || !viewport) return;
    const scrollTop = readerContent.scrollTop;
    const scrollHeight = readerContent.scrollHeight;
    const clientHeight = readerContent.clientHeight;
    if (scrollHeight <= 0) return;

    const top = (scrollTop / scrollHeight) * 100;
    const height = (clientHeight / scrollHeight) * 100;
    viewport.style.top = `${top}%`;
    viewport.style.height = `${height}%`;
  }

  readerContent.addEventListener("scroll", updateViewport);
  // initial sync after a tick (layout needs to settle)
  requestAnimationFrame(updateViewport);

  // click en minimap → scroll al punto
  if (minimap) {
    minimap.addEventListener("click", (e) => {
      const rect = minimap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = y / rect.height;
      readerContent.scrollTop = ratio * readerContent.scrollHeight;
    });
  }
}

function getExcerptColor(exc) {
  for (const cid of (exc.conceptIds || [])) {
    const concept = state.concepts[cid];
    if (concept?.themeId && state.themes[concept.themeId]) {
      return state.themes[concept.themeId].color;
    }
  }
  return "var(--accent)";
}
