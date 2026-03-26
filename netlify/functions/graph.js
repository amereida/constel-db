import { getDb } from "./utils/db.js";
import { requireAuth, json, error } from "./utils/auth.js";

/**
 * GET /api/graph                          — full concept graph for map
 * GET /api/graph?sources=id1,id2          — filter by sources
 * GET /api/graph?users=id1,id2            — filter by users
 * GET /api/graph?min_excerpts=N           — minimum excerpt count
 *
 * Returns { nodes: [...], links: [...], themes: [...] }
 */
export default async (req, context) => {
  const sql = getDb();
  const url = new URL(req.url);
  const minExcerpts = parseInt(url.searchParams.get("min_excerpts") || "1", 10);

  // Parse multi-value filters (comma-separated), with legacy single-value fallback
  const sourcesParam = url.searchParams.get("sources") || url.searchParams.get("source_id");
  const usersParam = url.searchParams.get("users") || url.searchParams.get("user_id");
  const sourceIds = sourcesParam ? sourcesParam.split(",").filter(Boolean) : null;
  const userIds = usersParam ? usersParam.split(",").filter(Boolean) : null;

  const hasSourceFilter = sourceIds && sourceIds.length > 0;
  const hasUserFilter = userIds && userIds.length > 0;

  // Build concept nodes with excerpt counts
  let concepts;
  if (hasSourceFilter && hasUserFilter) {
    concepts = await sql`
      SELECT c.id, c.label, c.created_by, tc.theme_id,
        count(DISTINCT ce.excerpt_id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      JOIN concept_excerpts ce ON ce.concept_id = c.id
      JOIN excerpts e ON e.id = ce.excerpt_id
      WHERE e.source_id = ANY(${sourceIds})
        AND (e.created_by = ANY(${userIds}) OR ce.linked_by = ANY(${userIds}))
      GROUP BY c.id, c.label, c.created_by, tc.theme_id
      HAVING count(DISTINCT ce.excerpt_id) >= ${minExcerpts}
      ORDER BY c.label
    `;
  } else if (hasSourceFilter) {
    concepts = await sql`
      SELECT c.id, c.label, c.created_by, tc.theme_id,
        count(DISTINCT ce.excerpt_id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      JOIN concept_excerpts ce ON ce.concept_id = c.id
      JOIN excerpts e ON e.id = ce.excerpt_id
      WHERE e.source_id = ANY(${sourceIds})
      GROUP BY c.id, c.label, c.created_by, tc.theme_id
      HAVING count(DISTINCT ce.excerpt_id) >= ${minExcerpts}
      ORDER BY c.label
    `;
  } else if (hasUserFilter) {
    concepts = await sql`
      SELECT c.id, c.label, c.created_by, tc.theme_id,
        count(DISTINCT ce.excerpt_id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      JOIN concept_excerpts ce ON ce.concept_id = c.id
      JOIN excerpts e ON e.id = ce.excerpt_id
      WHERE e.created_by = ANY(${userIds}) OR ce.linked_by = ANY(${userIds})
      GROUP BY c.id, c.label, c.created_by, tc.theme_id
      HAVING count(DISTINCT ce.excerpt_id) >= ${minExcerpts}
      ORDER BY c.label
    `;
  } else {
    concepts = await sql`
      SELECT c.id, c.label, c.created_by, tc.theme_id,
        count(DISTINCT ce.excerpt_id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      LEFT JOIN concept_excerpts ce ON ce.concept_id = c.id
      GROUP BY c.id, c.label, c.created_by, tc.theme_id
      HAVING count(DISTINCT ce.excerpt_id) >= ${minExcerpts}
      ORDER BY c.label
    `;
  }

  // Build links: concepts sharing excerpts (filtered to same scope)
  const conceptIds = concepts.map(c => c.id);
  let links = [];
  if (conceptIds.length > 0) {
    // When filters are active, only count co-occurrences within filtered excerpts
    if (hasSourceFilter || hasUserFilter) {
      const sourceFilter = hasSourceFilter ? sql`AND e1.source_id = ANY(${sourceIds})` : sql``;
      const userFilter = hasUserFilter ? sql`AND (e1.created_by = ANY(${userIds}) OR ce1.linked_by = ANY(${userIds}))` : sql``;

      links = await sql`
        SELECT ce1.concept_id AS source, ce2.concept_id AS target,
          count(*) AS weight
        FROM concept_excerpts ce1
        JOIN concept_excerpts ce2 ON ce1.excerpt_id = ce2.excerpt_id
          AND ce1.concept_id < ce2.concept_id
        JOIN excerpts e1 ON e1.id = ce1.excerpt_id
        WHERE ce1.concept_id = ANY(${conceptIds})
          AND ce2.concept_id = ANY(${conceptIds})
          ${sourceFilter}
          ${userFilter}
        GROUP BY ce1.concept_id, ce2.concept_id
      `;
    } else {
      links = await sql`
        SELECT ce1.concept_id AS source, ce2.concept_id AS target,
          count(*) AS weight
        FROM concept_excerpts ce1
        JOIN concept_excerpts ce2 ON ce1.excerpt_id = ce2.excerpt_id
          AND ce1.concept_id < ce2.concept_id
        WHERE ce1.concept_id = ANY(${conceptIds})
          AND ce2.concept_id = ANY(${conceptIds})
        GROUP BY ce1.concept_id, ce2.concept_id
      `;
    }
  }

  // Themes
  const themes = await sql`
    SELECT * FROM themes ORDER BY label
  `;

  // Format nodes for the map
  const maxCount = Math.max(1, ...concepts.map(c => Number(c.excerpt_count)));
  const nodes = concepts.map(c => ({
    id: c.id,
    label: c.label,
    themeId: c.theme_id,
    createdBy: c.created_by,
    excerptCount: Number(c.excerpt_count),
    score: Number(c.excerpt_count) / maxCount,
  }));

  return json({ nodes, links, themes });
};
