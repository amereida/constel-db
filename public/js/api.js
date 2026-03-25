// api.js — comunicación con el backend (Netlify Functions + Netlify Identity)

let _currentUser = null;
let _netlifyIdentity = null;

/**
 * Initialize the API layer. Call after Netlify Identity widget is loaded.
 */
export function initApi(identityInstance) {
  _netlifyIdentity = identityInstance;
}

/**
 * Get the current authenticated user (from Identity widget).
 */
export function getCurrentUser() {
  return _netlifyIdentity?.currentUser() || null;
}

/**
 * Get auth token for API requests.
 */
async function getToken() {
  const user = getCurrentUser();
  if (!user) return null;
  // Refresh token if needed
  const token = await user.jwt();
  return token;
}

/**
 * Authenticated fetch wrapper.
 */
async function request(method, path, body) {
  const token = await getToken();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };
  if (token) {
    opts.headers["Authorization"] = `Bearer ${token}`;
  }
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  /** Sync current user to DB after login */
  sync: () => request("POST", "/auth"),
  /** Get current user info */
  me: () => request("GET", "/auth"),
};

// ── Sources ──────────────────────────────────────────────────────────────────

export const sources = {
  list: () => request("GET", "/sources"),
  get: (id) => request("GET", `/sources?id=${id}`),
  create: (data) => request("POST", "/sources", data),
  update: (data) => request("PUT", "/sources", data),
  delete: (id) => request("DELETE", `/sources?id=${id}`),
};

// ── Excerpts ─────────────────────────────────────────────────────────────────

export const excerpts = {
  bySource: (sourceId) => request("GET", `/excerpts?source_id=${sourceId}`),
  byConcept: (conceptId) => request("GET", `/excerpts?concept_id=${conceptId}`),
  create: (data) => request("POST", "/excerpts", data),
  delete: (id) => request("DELETE", `/excerpts?id=${id}`),
};

// ── Concepts ─────────────────────────────────────────────────────────────────

export const concepts = {
  list: () => request("GET", "/concepts"),
  get: (id) => request("GET", `/concepts?id=${id}`),
  create: (data) => request("POST", "/concepts", data),
  rename: (id, label) => request("PUT", "/concepts", { id, label }),
  delete: (id) => request("DELETE", `/concepts?id=${id}`),
  linkExcerpt: (concept_id, excerpt_id) =>
    request("POST", "/concepts/link-excerpt", { concept_id, excerpt_id }),
  unlinkExcerpt: (concept_id, excerpt_id) =>
    request("POST", "/concepts/unlink-excerpt", { concept_id, excerpt_id }),
};

// ── Themes ───────────────────────────────────────────────────────────────────

export const themes = {
  list: () => request("GET", "/themes"),
  create: (data) => request("POST", "/themes", data),
  update: (data) => request("PUT", "/themes", data),
  delete: (id) => request("DELETE", `/themes?id=${id}`),
  addConcept: (theme_id, concept_id) =>
    request("POST", "/themes/add-concept", { theme_id, concept_id }),
  removeConcept: (theme_id, concept_id) =>
    request("POST", "/themes/remove-concept", { theme_id, concept_id }),
};

// ── Notes ────────────────────────────────────────────────────────────────────

export const notes = {
  byTheme: (themeId) => request("GET", `/notes?theme_id=${themeId}`),
  create: (data) => request("POST", "/notes", data),
  update: (data) => request("PUT", "/notes", data),
  delete: (id) => request("DELETE", `/notes?id=${id}`),
};

// ── Graph (concept map) ──────────────────────────────────────────────────────

export const graph = {
  /** Full graph */
  full: (minExcerpts = 1) => request("GET", `/graph?min_excerpts=${minExcerpts}`),
  /** Filtered by user */
  byUser: (userId, minExcerpts = 1) =>
    request("GET", `/graph?user_id=${userId}&min_excerpts=${minExcerpts}`),
  /** Filtered by source */
  bySource: (sourceId, minExcerpts = 1) =>
    request("GET", `/graph?source_id=${sourceId}&min_excerpts=${minExcerpts}`),
};

// ── Admin ────────────────────────────────────────────────────────────────────

export const admin = {
  users: () => request("GET", "/admin/users"),
  setRole: (id, role) => request("PUT", "/admin/users", { id, role }),
  activity: (limit = 100, userId = null) => {
    let path = `/admin/activity?limit=${limit}`;
    if (userId) path += `&user_id=${userId}`;
    return request("GET", path);
  },
  stats: () => request("GET", "/admin/stats"),
};
