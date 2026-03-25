import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error, logActivity } from "./utils/auth.js";

/**
 * GET    /api/concepts                    — list all concepts with counts
 * GET    /api/concepts?id=X               — single concept detail
 * POST   /api/concepts                    — create concept
 * PUT    /api/concepts                    — rename (own or admin)
 * DELETE /api/concepts?id=X               — delete (admin only)
 * POST   /api/concepts/link-excerpt       — add excerpt to existing concept
 * POST   /api/concepts/unlink-excerpt     — remove excerpt from concept (own link or admin)
 */
export default async (req, context) => {
  const { user, err } = requireAuth(context);
  if (err) return err;

  const sql = getDb();
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/concepts", "");

  // POST /api/concepts/link-excerpt
  if (req.method === "POST" && path === "/link-excerpt") {
    const { concept_id, excerpt_id } = await req.json();
    if (!concept_id || !excerpt_id) return error("concept_id y excerpt_id requeridos");
    await sql`
      INSERT INTO concept_excerpts (concept_id, excerpt_id, linked_by)
      VALUES (${concept_id}, ${excerpt_id}, ${user.id})
      ON CONFLICT DO NOTHING
    `;
    await logActivity(user.id, "link_excerpt", "concept", concept_id, { excerpt_id });
    return json({ ok: true });
  }

  // POST /api/concepts/unlink-excerpt
  if (req.method === "POST" && path === "/unlink-excerpt") {
    const { concept_id, excerpt_id } = await req.json();
    if (!concept_id || !excerpt_id) return error("concept_id y excerpt_id requeridos");

    // Check ownership of the link or admin
    const [link] = await sql`
      SELECT linked_by FROM concept_excerpts
      WHERE concept_id = ${concept_id} AND excerpt_id = ${excerpt_id}
    `;
    if (!link) return error("Vínculo no encontrado", 404);
    if (link.linked_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes desvincular tus propios vínculos", 403);
    }

    await sql`
      DELETE FROM concept_excerpts
      WHERE concept_id = ${concept_id} AND excerpt_id = ${excerpt_id}
    `;
    await logActivity(user.id, "unlink_excerpt", "concept", concept_id, { excerpt_id });
    return json({ ok: true });
  }

  // GET
  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) {
      const [concept] = await sql`
        SELECT c.*,
          tc.theme_id,
          u.name AS created_by_name,
          (SELECT count(*) FROM concept_excerpts WHERE concept_id = c.id) AS excerpt_count
        FROM concepts c
        LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
        LEFT JOIN users u ON u.id = c.created_by
        WHERE c.id = ${id}
      `;
      if (!concept) return error("Concepto no encontrado", 404);
      return json(concept);
    }

    // List all with excerpt count and theme
    const concepts = await sql`
      SELECT c.id, c.label, c.created_by,
        tc.theme_id,
        u.name AS created_by_name,
        (SELECT count(*) FROM concept_excerpts WHERE concept_id = c.id) AS excerpt_count
      FROM concepts c
      LEFT JOIN theme_concepts tc ON tc.concept_id = c.id
      LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.label
    `;
    return json(concepts);
  }

  // POST — create
  if (req.method === "POST") {
    const { label } = await req.json();
    if (!label?.trim()) return error("Label requerido");
    const [concept] = await sql`
      INSERT INTO concepts (label, created_by)
      VALUES (${label.trim().toLowerCase()}, ${user.id})
      RETURNING *
    `;
    await logActivity(user.id, "create_concept", "concept", concept.id);
    return json(concept, 201);
  }

  // PUT — rename
  if (req.method === "PUT") {
    const { id: cid, label } = await req.json();
    if (!cid || !label?.trim()) return error("ID y label requeridos");

    const [concept] = await sql`SELECT * FROM concepts WHERE id = ${cid}`;
    if (!concept) return error("Concepto no encontrado", 404);
    if (concept.created_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes renombrar tus propios conceptos", 403);
    }

    const [updated] = await sql`
      UPDATE concepts SET label = ${label.trim().toLowerCase()}, updated_at = now()
      WHERE id = ${cid} RETURNING *
    `;
    await logActivity(user.id, "rename_concept", "concept", cid, { old: concept.label, new: label });
    return json(updated);
  }

  // DELETE — admin only
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("ID requerido");
    if (!(await isAdmin(user.id))) {
      return error("Solo administradores pueden eliminar conceptos", 403);
    }
    await sql`DELETE FROM concepts WHERE id = ${id}`;
    await logActivity(user.id, "delete_concept", "concept", id);
    return json({ ok: true });
  }

  return error("Método no soportado", 405);
};
