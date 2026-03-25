// autocomplete.js — input con dropdown fuzzy para conceptos

import { fuzzyMatch, isNewConcept } from "../fuzzy.js";
import { getAllConceptLabels } from "../state.js";

/**
 * Inicializa el autocomplete en un input.
 * @param {HTMLInputElement} input
 * @param {HTMLElement} dropdown
 * @param {Function} onSelect - (concept: {id, label} | {label, isNew: true}) => void
 */
export function initAutocomplete(input, dropdown, onSelect) {
  let highlighted = -1;
  let items = [];

  function render() {
    const query = input.value.trim();
    if (!query) {
      dropdown.hidden = true;
      items = [];
      return;
    }

    const candidates = getAllConceptLabels();
    const matches = fuzzyMatch(query, candidates);
    const showNew = isNewConcept(query, candidates);

    items = [];
    dropdown.innerHTML = "";

    for (const m of matches) {
      const div = document.createElement("div");
      div.className = "autocomplete-item";
      div.innerHTML = `<span>${highlightMatch(m.label, query)}</span><span class="count">${m.count}§</span>`;
      div.addEventListener("click", () => {
        onSelect({ id: m.id, label: m.label });
        close();
      });
      dropdown.appendChild(div);
      items.push({ el: div, data: { id: m.id, label: m.label } });
    }

    if (showNew) {
      const div = document.createElement("div");
      div.className = "autocomplete-item autocomplete-new";
      div.textContent = `+ Crear "${query}"`;
      div.addEventListener("click", () => {
        onSelect({ label: query, isNew: true });
        close();
      });
      dropdown.appendChild(div);
      items.push({ el: div, data: { label: query, isNew: true } });
    }

    highlighted = -1;
    dropdown.hidden = items.length === 0;
  }

  function close() {
    dropdown.hidden = true;
    highlighted = -1;
  }

  function setHighlight(idx) {
    items.forEach((it, i) => it.el.classList.toggle("highlighted", i === idx));
    highlighted = idx;
  }

  input.addEventListener("input", render);

  input.addEventListener("keydown", (e) => {
    if (dropdown.hidden) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(Math.min(highlighted + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(highlighted - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < items.length) {
        onSelect(items[highlighted].data);
        close();
      } else if (input.value.trim()) {
        // enter sin selección → crear nuevo o usar primero
        const query = input.value.trim();
        const candidates = getAllConceptLabels();
        if (isNewConcept(query, candidates)) {
          onSelect({ label: query, isNew: true });
        } else {
          const matches = fuzzyMatch(query, candidates, 1);
          if (matches.length) onSelect({ id: matches[0].id, label: matches[0].label });
        }
        close();
      }
    } else if (e.key === "Escape") {
      close();
    }
  });

  // cerrar al perder foco (con delay para permitir clicks)
  input.addEventListener("blur", () => setTimeout(() => { dropdown.hidden = true; }, 200));

  return { close, render };
}

function highlightMatch(label, query) {
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return escapeHtml(label);
  return escapeHtml(label.slice(0, idx)) +
    `<span class="match">${escapeHtml(label.slice(idx, idx + q.length))}</span>` +
    escapeHtml(label.slice(idx + q.length));
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
