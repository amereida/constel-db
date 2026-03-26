// minimap.js — barra vertical de densidad tipo Wattenberg
// Muestra el texto como barra vertical 100% de alto con bandas de color por excerpts.

import { state, getExcerptsForSource } from "../state.js";

/**
 * Renderiza el minimap vertical para un source.
 * Uses rendered <mark> positions in the DOM instead of character offsets.
 * @param {HTMLElement} container - .reader-minimap-strip
 * @param {string} sourceId
 * @param {number} textLength - largo del texto en caracteres (for stats only)
 * @param {HTMLElement} scrollContainer - .reader-text-panel for scroll sync
 */
export function renderMinimap(container, sourceId, textLength, scrollContainer) {
  const excerpts = getExcerptsForSource(sourceId);

  // Build minimap HTML shell
  container.innerHTML = `
    <div class="minimap">
      <div class="minimap-viewport" id="minimapViewport"></div>
    </div>
    <div class="minimap-stats">
      <span>${excerpts.length}§</span>
      <span id="minimapPct">0%</span>
    </div>
  `;

  const minimap = container.querySelector(".minimap");
  const viewport = container.querySelector("#minimapViewport");
  const pctEl = container.querySelector("#minimapPct");

  // Wait for layout to settle, then compute band positions from DOM marks
  requestAnimationFrame(() => {
    if (!scrollContainer) return;
    const scrollHeight = scrollContainer.scrollHeight;
    if (scrollHeight <= 0) return;

    // Find all <mark> elements in the reader content
    const textContent = scrollContainer.querySelector(".reader-content");
    if (!textContent) return;

    const marks = textContent.querySelectorAll("mark[data-excerpt]");
    let totalMarkedHeight = 0;

    marks.forEach(mark => {
      const excId = mark.dataset.excerpt;
      const exc = state.excerpts[excId];
      const color = exc ? getExcerptColor(exc) : "var(--accent)";

      // Get position relative to scroll container
      const markRect = mark.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const markTop = mark.offsetTop || (markRect.top - containerRect.top + scrollContainer.scrollTop);
      const markHeight = markRect.height;

      const topPct = (markTop / scrollHeight) * 100;
      const heightPct = Math.max(0.3, (markHeight / scrollHeight) * 100);

      const band = document.createElement("div");
      band.className = "minimap-band";
      band.style.top = `${topPct}%`;
      band.style.height = `${heightPct}%`;
      band.style.background = color;
      minimap.insertBefore(band, viewport);

      totalMarkedHeight += markHeight;
    });

    // Update percentage
    const pct = scrollHeight > 0 ? Math.round((totalMarkedHeight / scrollHeight) * 100) : 0;
    if (pctEl) pctEl.textContent = `${pct}%`;

    // Sync viewport indicator
    function updateViewport() {
      if (!viewport) return;
      const st = scrollContainer.scrollTop;
      const sh = scrollContainer.scrollHeight;
      const ch = scrollContainer.clientHeight;
      if (sh <= 0) return;
      viewport.style.top = `${(st / sh) * 100}%`;
      viewport.style.height = `${(ch / sh) * 100}%`;
    }

    scrollContainer.addEventListener("scroll", updateViewport);
    updateViewport();

    // Click minimap → scroll
    minimap.addEventListener("click", (e) => {
      const rect = minimap.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      scrollContainer.scrollTop = ratio * scrollContainer.scrollHeight;
    });
  });
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
