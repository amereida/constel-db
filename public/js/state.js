// state.js — store central con pub/sub
// In-memory cache backed by API. Reads are instant, writes sync to server.
// API devuelve snake_case; normalizamos a camelCase al almacenar.

import * as api from "./api.js";

// ── Normalizadores (API snake_case → frontend camelCase) ─────────────────────

function normalizeExcerpt(raw) {
  return {
    ...raw,
    sourceId:   raw.source_id   ?? raw.sourceId,
    start:      raw.start_pos   ?? raw.start,
    end:        raw.end_pos     ?? raw.end,
    conceptIds: raw.concept_ids ?? raw.conceptIds ?? [],
    createdBy:  raw.created_by  ?? raw.createdBy,
  };
}

function normalizeConcept(raw) {
  return {
    ...raw,
    themeId:      raw.theme_id      ?? raw.themeId ?? null,
    excerptCount: raw.excerpt_count ?? raw.excerptCount ?? 0,
    createdBy:    raw.created_by    ?? raw.createdBy,
  };
}

// ── Slugify ─────────────────────────────────────────────────────────────────

export function slugify(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")  // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "");     // trim leading/trailing dashes
}

/**
 * Find a source by slug (derived from title).
 * Returns the source object or null.
 */
export function resolveSourceBySlug(slug) {
  if (!slug) return null;
  // Direct ID match first (backward compat)
  if (state.sources[slug]) return state.sources[slug];
  // Slug match
  for (const src of Object.values(state.sources)) {
    if (slugify(src.title) === slug || slugify(src.filename) === slug) return src;
  }
  return null;
}

/**
 * Get slug for a source.
 */
export function getSourceSlug(sourceId) {
  const src = state.sources[sourceId];
  if (!src) return sourceId; // fallback to ID
  return slugify(src.title || src.filename);
}

// ── Estado (in-memory cache) ─────────────────────────────────────────────────

export const state = {
  currentUser: null, // { id, email, name, role } — from DB after auth.sync
  sources: {},   // id → { id, filename, title, author, date, word_count, ... }
  excerpts: {},  // id → { id, sourceId, text, start, end, conceptIds[], createdBy, ... }
  concepts: {},  // id → { id, label, themeId, createdBy, excerptCount, ... }
  themes: {},    // id → { id, label, color, created_by, ... }
  notes: {},     // id → { id, theme_id, text, created_by, ... }
  ui: {
    selectedConceptId: null,
  },
};

// ── Pub/Sub ─────────────────────────────────────────────────────────────────

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error("subscriber error:", e); }
  }
}

// ── Carga inicial ───────────────────────────────────────────────────────────

export async function loadState() {
  try {
    // Load all data in parallel
    const [sourceList, conceptList, themeList, excerptList] = await Promise.all([
      api.sources.list(),
      api.concepts.list(),
      api.themes.list(),
      api.excerpts.list(),
    ]);

    // Index by ID
    state.sources = {};
    for (const s of sourceList) state.sources[s.id] = s;

    state.concepts = {};
    for (const c of conceptList) state.concepts[c.id] = normalizeConcept(c);

    state.themes = {};
    for (const t of themeList) state.themes[t.id] = t;

    state.excerpts = {};
    for (const exc of excerptList) state.excerpts[exc.id] = normalizeExcerpt(exc);

    state.notes = {};

  } catch (e) {
    console.error("Error loading state:", e);
  }
}

/**
 * Load excerpts for a specific source (called when opening a text).
 */
export async function loadExcerptsForSource(sourceId) {
  try {
    const rows = await api.excerpts.bySource(sourceId);
    for (const exc of rows) {
      state.excerpts[exc.id] = normalizeExcerpt(exc);
    }
    notify();
  } catch (e) {
    console.error("Error loading excerpts:", e);
  }
}

/**
 * Load excerpts for a specific concept (called from themes tab).
 */
export async function loadExcerptsForConcept(conceptId) {
  try {
    const rows = await api.excerpts.byConcept(conceptId);
    for (const exc of rows) {
      state.excerpts[exc.id] = normalizeExcerpt(exc);
    }
    notify();
    return rows.map(r => normalizeExcerpt(r));
  } catch (e) {
    console.error("Error loading excerpts for concept:", e);
    return [];
  }
}

/**
 * Load notes for a specific theme.
 */
export async function loadNotesForTheme(themeId) {
  try {
    const rows = await api.notes.byTheme(themeId);
    for (const n of rows) {
      state.notes[n.id] = n;
    }
  } catch (e) {
    console.error("Error loading notes:", e);
  }
}

// ── CRUD: Sources ───────────────────────────────────────────────────────────

export async function addSource({ filename, title, author, date, content }) {
  try {
    const source = await api.sources.create({ filename, title, author, date, content });
    state.sources[source.id] = source;
    notify();
    return source.id;
  } catch (e) {
    console.error("Error creating source:", e);
    throw e;
  }
}

export async function removeSource(id) {
  try {
    await api.sources.delete(id);
    delete state.sources[id];
    // Remove cached excerpts for this source
    for (const [eid, exc] of Object.entries(state.excerpts)) {
      if (exc.sourceId === id) delete state.excerpts[eid];
    }
    notify();
  } catch (e) {
    console.error("Error removing source:", e);
    throw e;
  }
}

export async function updateSource(id, fields) {
  try {
    const source = await api.sources.update({ id, ...fields });
    state.sources[id] = source;
    notify();
  } catch (e) {
    console.error("Error updating source:", e);
    throw e;
  }
}

export function getSource(id) {
  return state.sources[id] || null;
}

/**
 * Get full source content (lazy loaded).
 */
export async function getSourceContent(id) {
  try {
    const full = await api.sources.get(id);
    state.sources[id] = full;
    return full.content;
  } catch (e) {
    console.error("Error loading source content:", e);
    return null;
  }
}

// ── CRUD: Excerpts ──────────────────────────────────────────────────────────

export async function addExcerpt({ sourceId, text, conceptIds }) {
  try {
    const exc = await api.excerpts.create({
      source_id: sourceId,
      text,
      concept_ids: conceptIds || [],
    });
    state.excerpts[exc.id] = normalizeExcerpt(exc);
    notify();
    return exc.id;
  } catch (e) {
    console.error("Error creating excerpt:", e);
    throw e;
  }
}

/**
 * Update just the content of a source (e.g. after inserting/removing milestones).
 * Updates local cache and re-notifies subscribers.
 */
export async function updateSourceContent(sourceId, content) {
  try {
    await api.sources.update({ id: sourceId, content });
    if (state.sources[sourceId]) {
      state.sources[sourceId].content = content;
    }
    notify();
  } catch (e) {
    console.error("Error updating source content:", e);
    throw e;
  }
}

export async function removeExcerpt(id) {
  try {
    const exc = state.excerpts[id];
    await api.excerpts.delete(id);

    // Remove milestones from source content
    if (exc?.sourceId) {
      const src = state.sources[exc.sourceId];
      if (src?.content) {
        const { removeMilestones } = await import("./components/text-highlighter.js");
        const cleaned = removeMilestones(src.content, id);
        if (cleaned !== src.content) {
          await api.sources.update({ id: exc.sourceId, content: cleaned });
          src.content = cleaned;
        }
      }
    }

    delete state.excerpts[id];
    notify();
  } catch (e) {
    console.error("Error removing excerpt:", e);
    throw e;
  }
}

export async function addConceptToExcerpt(excerptId, conceptId) {
  try {
    await api.concepts.linkExcerpt(conceptId, excerptId);
    const exc = state.excerpts[excerptId];
    if (exc && !exc.conceptIds?.includes(conceptId)) {
      exc.conceptIds = [...(exc.conceptIds || []), conceptId];
    }
    notify();
  } catch (e) {
    console.error("Error linking concept to excerpt:", e);
  }
}

export async function removeConceptFromExcerpt(excerptId, conceptId) {
  try {
    const result = await api.concepts.unlinkExcerpt(conceptId, excerptId);
    const exc = state.excerpts[excerptId];
    if (exc) {
      exc.conceptIds = (exc.conceptIds || []).filter(id => id !== conceptId);
      // Rule: no orphan excerpts — backend already deleted if 0 concepts
      if (exc.conceptIds.length === 0) {
        delete state.excerpts[excerptId];
      }
    }
    notify();
    return result;
  } catch (e) {
    console.error("Error unlinking concept from excerpt:", e);
  }
}

export function getExcerptsForSource(sourceId) {
  return Object.values(state.excerpts).filter(e => e.sourceId === sourceId);
}

export function getExcerptsForConcept(conceptId) {
  return Object.values(state.excerpts).filter(e =>
    (e.conceptIds || []).includes(conceptId)
  );
}

// ── CRUD: Concepts ──────────────────────────────────────────────────────────

export async function addConcept(label, themeId = null) {
  try {
    const concept = normalizeConcept(await api.concepts.create({ label }));
    state.concepts[concept.id] = concept;
    if (themeId) {
      await api.themes.addConcept(themeId, concept.id);
      concept.themeId = themeId;
    }
    notify();
    return concept.id;
  } catch (e) {
    console.error("Error creating concept:", e);
    throw e;
  }
}

export async function removeConcept(id) {
  try {
    const result = await api.concepts.delete(id);
    // Update local state: remove concept from excerpts, delete orphans
    for (const [excId, exc] of Object.entries(state.excerpts)) {
      if (exc.conceptIds?.includes(id)) {
        exc.conceptIds = exc.conceptIds.filter(cid => cid !== id);
        // Rule: no orphan excerpts — if 0 concepts left, server already deleted it
        if (exc.conceptIds.length === 0) {
          delete state.excerpts[excId];
        }
      }
    }
    delete state.concepts[id];
    notify();
    return result;
  } catch (e) {
    console.error("Error removing concept:", e);
    throw e;
  }
}

export async function renameConcept(id, newLabel) {
  try {
    const updated = await api.concepts.rename(id, newLabel);
    state.concepts[id] = { ...state.concepts[id], ...updated };
    notify();
  } catch (e) {
    console.error("Error renaming concept:", e);
  }
}

export async function moveConcept(id, newThemeId) {
  try {
    const c = state.concepts[id];
    // Remove from old theme
    if (c?.themeId) {
      await api.themes.removeConcept(c.themeId, id);
    }
    // Add to new theme
    if (newThemeId) {
      await api.themes.addConcept(newThemeId, id);
    }
    if (c) c.themeId = newThemeId;
    notify();
  } catch (e) {
    console.error("Error moving concept:", e);
  }
}

export function findConceptByLabel(label) {
  const norm = label.toLowerCase().trim();
  return Object.values(state.concepts).find(c => c.label.toLowerCase().trim() === norm) || null;
}

export function getAllConceptLabels() {
  return Object.values(state.concepts).map(c => ({
    id: c.id,
    label: c.label,
    count: Number(c.excerptCount) || getExcerptsForConcept(c.id).length,
  }));
}

export function getConceptsForTheme(themeId) {
  return Object.values(state.concepts).filter(c => c.themeId === themeId);
}

export function getUngroupedConcepts() {
  return Object.values(state.concepts).filter(c => !c.themeId);
}

// ── CRUD: Themes ────────────────────────────────────────────────────────────

const THEME_COLORS = [
  "#2d6a5a", "#6366f1", "#d97706", "#dc2626",
  "#7c3aed", "#0891b2", "#65a30d", "#be185d",
  "#0d9488", "#4338ca", "#ea580c", "#9333ea",
];

export async function addTheme(label) {
  try {
    const idx = Object.keys(state.themes).length;
    const color = THEME_COLORS[idx % THEME_COLORS.length];
    const theme = await api.themes.create({ label, color });
    state.themes[theme.id] = theme;
    notify();
    return theme.id;
  } catch (e) {
    console.error("Error creating theme:", e);
    throw e;
  }
}

export async function removeTheme(id) {
  try {
    await api.themes.delete(id);
    // Ungroup local concepts
    for (const c of Object.values(state.concepts)) {
      if (c.themeId === id) c.themeId = null;
    }
    // Remove local notes
    for (const [nid, n] of Object.entries(state.notes)) {
      if (n.theme_id === id) delete state.notes[nid];
    }
    delete state.themes[id];
    notify();
  } catch (e) {
    console.error("Error removing theme:", e);
    throw e;
  }
}

export async function renameTheme(id, newLabel) {
  try {
    const updated = await api.themes.update({ id, label: newLabel });
    state.themes[id] = { ...state.themes[id], ...updated };
    notify();
  } catch (e) {
    console.error("Error renaming theme:", e);
  }
}

export function getThemeColor(themeId) {
  if (state.themes[themeId]?.color) return state.themes[themeId].color;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return isDark ? "#a2a4a7d3" : "#28262fe2";
}

// ── CRUD: Notes ─────────────────────────────────────────────────────────────

export async function addNote(themeId, text) {
  try {
    const note = await api.notes.create({ theme_id: themeId, text });
    state.notes[note.id] = note;
    notify();
    return note.id;
  } catch (e) {
    console.error("Error creating note:", e);
    throw e;
  }
}

export async function updateNote(id, text) {
  try {
    const updated = await api.notes.update({ id, text });
    state.notes[id] = { ...state.notes[id], ...updated };
    notify();
  } catch (e) {
    console.error("Error updating note:", e);
  }
}

export async function removeNote(id) {
  try {
    await api.notes.delete(id);
    delete state.notes[id];
    notify();
  } catch (e) {
    console.error("Error removing note:", e);
  }
}

export function getNotesForTheme(themeId) {
  return Object.values(state.notes).filter(n => n.theme_id === themeId);
}

export function getNotesForConcept(conceptId) {
  return Object.values(state.notes).filter(n => n.concept_id === conceptId);
}

export async function loadNotesForConcept(conceptId) {
  try {
    const rows = await api.notes.byConcept(conceptId);
    for (const n of rows) state.notes[n.id] = n;
    return rows;
  } catch (e) {
    console.error("Error loading notes for concept:", e);
    return [];
  }
}

export async function addConceptNote(conceptId, text) {
  try {
    const note = await api.notes.create({ concept_id: conceptId, text });
    state.notes[note.id] = note;
    notify();
    return note.id;
  } catch (e) {
    console.error("Error creating concept note:", e);
    throw e;
  }
}

// ── Graph query ─────────────────────────────────────────────────────────────

/**
 * Fetch concept graph from API.
 * Falls back to local computation if API fails.
 */
export async function computeConceptGraph({ sourceId, userId, sourceIds, userIds } = {}) {
  try {
    // Multi-filter (from map filter drawer)
    if (sourceIds?.length || userIds?.length) {
      return await api.graph.filtered({ sourceIds, userIds });
    }
    // Legacy single-value params
    if (userId) return await api.graph.byUser(userId);
    if (sourceId) return await api.graph.bySource(sourceId);
    return await api.graph.full();
  } catch (e) {
    console.warn("Graph API failed, computing locally:", e);
    return computeConceptGraphLocal(sourceId);
  }
}

/**
 * Local graph computation (fallback).
 */
function computeConceptGraphLocal(sourceId = null) {
  const excList = sourceId
    ? Object.values(state.excerpts).filter(e => e.sourceId === sourceId)
    : Object.values(state.excerpts);

  const conceptIds = new Set();
  for (const exc of excList) {
    for (const cid of (exc.conceptIds || [])) conceptIds.add(cid);
  }

  const maxCount = Math.max(1, ...Object.values(state.concepts).map(c => Number(c.excerptCount) || 0));
  const nodes = [...conceptIds]
    .map(id => state.concepts[id])
    .filter(Boolean)
    .map(c => ({
      id: c.id,
      label: c.label,
      themeId: c.themeId,
      excerptCount: Number(c.excerptCount) || 0,
      score: (Number(c.excerptCount) || 0) / maxCount,
    }));

  // Co-excerpt links
  const linkMap = new Map();
  for (const exc of excList) {
    const cids = exc.conceptIds || [];
    for (let i = 0; i < cids.length; i++) {
      for (let j = i + 1; j < cids.length; j++) {
        const k = cids[i] < cids[j] ? `${cids[i]}::${cids[j]}` : `${cids[j]}::${cids[i]}`;
        if (!linkMap.has(k)) linkMap.set(k, { source: cids[i], target: cids[j], weight: 0 });
        linkMap.get(k).weight++;
      }
    }
  }

  return { nodes, links: [...linkMap.values()], themes: Object.values(state.themes) };
}

// ── Estadísticas ────────────────────────────────────────────────────────────

export function getStats() {
  return {
    sources: Object.keys(state.sources).length,
    excerpts: Object.keys(state.excerpts).length,
    concepts: Object.keys(state.concepts).length,
    themes: Object.keys(state.themes).length,
    notes: Object.keys(state.notes).length,
  };
}

// ── UI State ────────────────────────────────────────────────────────────────

export function setSelectedConcept(conceptId) {
  state.ui.selectedConceptId = conceptId;
}

export function getSelectedConcept() {
  return state.ui.selectedConceptId;
}
