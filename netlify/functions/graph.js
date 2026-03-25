import { getDb } from "./utils/db.js";
import { requireAuth, json, error } from "./utils/auth.js";

/**
 * GET /api/graph                          — full concept graph for map
 * GET /api/graph?user_id=X                — graph filtered by user
 * GET /api/graph?source_id=X              — graph filtered by source
 * GET /api/graph?min_excerpts=N           — filter by minimum excerpt count
 *
 * Returns { nodes: [...], links: [...], themes: [...] }
 * Compatible with both 2D and 3D concept maps.
 */
export default async (req, context) => {
  const sql = getDb();
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  const sourceId = url.searchParams.get("source_id");
  const minExcerpts = parseInt(url.searchParams.get("min_excerpts") || "1", 10);

  // Build concept nodes with excerpt counts
  let concepts;
  if (userId) {
    // Only concepts created by or linked to by this user
    concepts = await sql`
      SELECT c.id, c.label, c.created_by, tc.theme_id,
        count(DISTINCT ce.excerpt_id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      JOIN concept_excerpts ce ON ce.concept_id = c.id
      JOIN excerpts e ON e.id = ce.excerpt_id
      WHERE e.created_by = ${userId} OR ce.linked_by = ${userId}
      GROUP BY c.id, c.label, c.created_by, tc.theme_id
      HAVING count(DISTINCT ce.excerpt_id) >= ${minExcerpts}
      ORDER BY c.label
    `;
  } else if (sourceId) {
    concepts = await sql`
      SELECT c.id, c.label, c.created_by, tc.theme_id,
        count(DISTINCT ce.excerpt_id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      JOIN concept_excerpts ce ON ce.concept_id = c.id
      JOIN excerpts e ON e.id = ce.excerpt_id
      WHERE e.source_id = ${sourceId}
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

  // Build links: concepts sharing excerpts
  const conceptIds = concepts.map(c => c.id);
  let links = [];
  if (conceptIds.length > 0) {
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
