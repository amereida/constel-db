// split-view.js — paneles redimensionables
// Usa el atributo data-split del handle para persistir la proporción.

const STORAGE_PREFIX = "constel-split-";
const MIN_WIDTH = 200; // px mínimo por panel

export function initSplitViews() {
  document.querySelectorAll(".split-handle").forEach(handle => {
    const splitId = handle.dataset.split;
    const parent = handle.parentElement;
    const left = parent.querySelector(".split-left");
    const right = parent.querySelector(".split-right");
    if (!left || !right) return;

    // restaurar proporción guardada
    const saved = localStorage.getItem(STORAGE_PREFIX + splitId);
    if (saved) {
      const ratio = parseFloat(saved);
      if (ratio > 0.1 && ratio < 0.9) {
        left.style.flex = `0 0 ${ratio * 100}%`;
        right.style.flex = `1`;
      }
    }

    let dragging = false;

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      handle.classList.add("dragging");
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(MIN_WIDTH / rect.width, Math.min(1 - MIN_WIDTH / rect.width, x / rect.width));
      left.style.flex = `0 0 ${ratio * 100}%`;
      right.style.flex = `1`;
      localStorage.setItem(STORAGE_PREFIX + splitId, ratio.toString());
    });

    handle.addEventListener("pointerup", () => {
      dragging = false;
      handle.classList.remove("dragging");
    });
  });
}
