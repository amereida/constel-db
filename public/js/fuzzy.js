// fuzzy.js — búsqueda difusa para autocomplete de conceptos

/**
 * Normaliza texto para comparación: minúsculas, sin acentos.
 */
function normalize(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Calcula un score de coincidencia entre query y candidate.
 * Retorna 0 si no hay match, mayor = mejor.
 */
function fuzzyScore(query, candidate) {
  const q = normalize(query);
  const c = normalize(candidate);

  // coincidencia exacta
  if (c === q) return 100;

  // comienza con
  if (c.startsWith(q)) return 80 + (q.length / c.length) * 20;

  // contiene como substring
  const idx = c.indexOf(q);
  if (idx !== -1) return 60 + (q.length / c.length) * 20;

  // coincidencia de caracteres en orden (fuzzy)
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      score += 10;
      // bonus por caracteres consecutivos
      if (lastMatchIdx === ci - 1) score += 5;
      // bonus por inicio de palabra
      if (ci === 0 || c[ci - 1] === " " || c[ci - 1] === "-") score += 3;
      lastMatchIdx = ci;
      qi++;
    }
  }

  // todos los caracteres del query deben haber coincidido
  if (qi < q.length) return 0;

  // normalizar por longitud
  return Math.min(59, score * (q.length / c.length));
}

/**
 * Filtra y ordena candidatos por relevancia.
 * @param {string} query - texto de búsqueda
 * @param {Array<{id, label, count}>} candidates - conceptos existentes
 * @param {number} limit - máximo de resultados
 * @returns {Array<{id, label, count, score}>}
 */
export function fuzzyMatch(query, candidates, limit = 10) {
  if (!query || !query.trim()) return [];

  const results = [];
  for (const c of candidates) {
    const score = fuzzyScore(query, c.label);
    if (score > 0) {
      results.push({ ...c, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Verifica si un query es lo suficientemente distinto de todos los candidatos
 * para ser considerado un concepto nuevo.
 */
export function isNewConcept(query, candidates) {
  const norm = normalize(query.trim());
  return !candidates.some(c => normalize(c.label) === norm);
}
