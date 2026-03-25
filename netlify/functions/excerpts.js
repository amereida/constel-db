import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error, logActivity } from "./utils/auth.js";

/**
 * GET    /api/excerpts?source_id=X          — excerpts for a source
 * GET    /api/excerpts?concept_id=X         — excerpts for a concept
 * POST   /api/excerpts                      — create excerpt + link to concepts
 * DELETE /api/excerpts?id=X                 — delete (own or admin)
 */
export default async (req, context) => {
  const sql = getDb();
  const url = new URL(req.url);

  // GET — public (no auth required)
  if (req.method === "GET") {
    const sourceId = url.searchParams.get("source_id");
    const conceptId = url.searchParams.get("concept_id");

    if (sourceId) {
      const rows = await sql`
        SELECT e.*,
          array_agg(ce.concept_id) FILTER (WHERE ce.concept_id IS NOT NULL) AS concept_ids,
          u.name AS created_by_name
        FROM excerpts e
        LEFT JOIN concept_excerpts ce ON ce.excerpt_id = e.id
        LEFT JOIN users u ON u.id = e.created_by
        WHERE e.source_id = ${sourceId}
        GROUP BY e.id, u.name
        ORDER BY e.start_pos
      `;
      return json(rows);
    }

    if (conceptId) {
      const rows = await sql`
        SELECT e.*,
          s.title AS source_title, s.author AS source_author,
          u.name AS created_by_name
        FROM excerpts e
        JOIN concept_excerpts ce ON ce.excerpt_id = e.id
        JOIN sources s ON s.id = e.source_id
        LEFT JOIN users u ON u.id = e.created_by
        WHERE ce.concept_id = ${conceptId}
        ORDER BY s.date, e.start_pos
      `;
      return json(rows);
    }

    return error("source_id o concept_id requerido");
  }

  // Auth required for mutations
  const { user, err } = requireAuth(context);
  if (err) return err;

  // POST — create excerpt
  if (req.method === "POST") {
    const body = await req.json();
    const { source_id, text, start_pos, end_pos, concept_ids = [] } = body;
    if (!source_id || start_pos == null || end_pos == null) {
      return error("source_id, start_pos y end_pos requeridos");
    }

    const [excerpt] = await sql`
      INSERT INTO excerpts (source_id, text, start_pos, end_pos, created_by)
      VALUES (${source_id}, ${text || ""}, ${start_pos}, ${end_pos}, ${user.id})
      RETURNING *
    `;

    // Link to concepts
    for (const cid of concept_ids) {
      await sql`
        INSERT INTO concept_excerpts (concept_id, excerpt_id, linked_by)
        VALUES (${cid}, ${excerpt.id}, ${user.id})
        ON CONFLICT DO NOTHING
      `;
    }

    await logActivity(user.id, "create_excerpt", "excerpt", excerpt.id, { concept_ids });
    return json({ ...excerpt, concept_ids }, 201);
  }

  // DELETE — own excerpt or admin
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("ID requerido");

    const [excerpt] = await sql`SELECT * FROM excerpts WHERE id = ${id}`;
    if (!excerpt) return error("Excerpt no encontrado", 404);

    if (excerpt.created_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes eliminar tus propios excerpts", 403);
    }

    await sql`DELETE FROM excerpts WHERE id = ${id}`;
    await logActivity(user.id, "delete_excerpt", "excerpt", id);
    return json({ ok: true });
  }

  return error("Método no soportado", 405);
};
