// concept-gloss.js — Lista cronológica de conceptos como glosa marginal
//
// Los conceptos se listan verticalmente en el orden de su primera aparición
// en el texto. Layout de flujo normal (no absoluto) para evitar traslape.
// Jerarquía visual por frecuencia: nivel 0 (multi-source), 1 (multi-excerpt), 2 (single).

import { state, getExcerptsForSource, getExcerptsForConcept } from "../state.js";

/**
 * @param {HTMLElement} container
 * @param {string} sourceId
 * @param {number} textLength
 * @param {Object} opts
 * @param {Function} opts.onClickConcept
 * @param {string|null} opts.selectedConceptId
 * @returns {{ update(selectedId), cleanup() }}
 */
export function renderConceptGloss(container, sourceId, textLength, opts = {}) {
  const excerpts = getExcerptsForSource(sourceId);
  if (!excerpts.length) {
    container.innerHTML = `<p class="placeholder" style="font-size:var(--font-size-sm);padding:var(--space-md)">
      Selecciona texto para crear el primer concepto [a]
    </p>`;
    return { update() {}, cleanup() {} };
  }

  // Build concept data
  const conceptMap = new Map();

  for (const exc of excerpts) {
    for (const cid of exc.conceptIds) {
      if (!conceptMap.has(cid)) {
        const c = state.concepts[cid];
        if (!c) continue;
        conceptMap.set(cid, {
          id: cid,
          label: c.label,
          firstOffset: exc.start,
          localCount: 0,
          globalCount: getExcerptsForConcept(cid).length,
        });
      }
      const entry = conceptMap.get(cid);
      entry.localCount++;
      if (exc.start < entry.firstOffset) {
        entry.firstOffset = exc.start;
      }
    }
  }

  // Sort by first appearance
  const sorted = [...conceptMap.values()].sort((a, b) => a.firstOffset - b.firstOffset);

  // Determine hierarchy level
  for (const entry of sorted) {
    const sourcesSet = new Set();
    const allExc = getExcerptsForConcept(entry.id);
    for (const e of allExc) sourcesSet.add(e.sourceId);

    if (sourcesSet.size > 1) {
      entry.level = 0; // multi-source: most prominent
    } else if (entry.localCount > 1) {
      entry.level = 1; // multi-excerpt in this text
    } else {
      entry.level = 2; // single mention
    }
  }

  // Render as normal flow list
  container.innerHTML = "";

  const listEl = document.createElement("div");
  listEl.className = "gloss-list";
  container.appendChild(listEl);

  for (const entry of sorted) {
    const item = document.createElement("div");
    item.className = `gloss-item level-${entry.level}`;
    item.dataset.conceptId = entry.id;

    const label = document.createElement("span");
    label.className = "gloss-label";
    label.textContent = entry.label;
    item.appendChild(label);

    if (entry.globalCount > 1) {
      const badge = document.createElement("span");
      badge.className = "gloss-count";
      badge.textContent = entry.globalCount;
      item.appendChild(badge);
    }

    item.addEventListener("click", () => {
      if (opts.onClickConcept) opts.onClickConcept(entry.id);
    });

    listEl.appendChild(item);
  }

  if (opts.selectedConceptId) {
    applySelection(container, opts.selectedConceptId);
  }

  return {
    update(selectedId) {
      applySelection(container, selectedId);
    },
    cleanup() {
      container.innerHTML = "";
    },
  };
}

function applySelection(container, conceptId) {
  container.querySelectorAll(".gloss-item").forEach(el => {
    el.classList.toggle("selected", el.dataset.conceptId === conceptId);
  });
}
