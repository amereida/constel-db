import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error, logActivity } from "./utils/auth.js";

/** Remove milestone comments for a given excerpt ID from source content. */
function removeMilestones(content, excerptId) {
  const esc = excerptId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content
    .replace(new RegExp(`<!-- §b ${esc} -->`, "g"), "")
    .replace(new RegExp(`<!-- §e ${esc} -->`, "g"), "");
}

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
  const sql = getDb();
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/concepts", "");

  // GET — public (no auth required)
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

  // Auth required for mutations
  const { user, err } = requireAuth(context, req);
  if (err) return err;

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

    // Rule: no orphan excerpts. If excerpt has 0 concepts, delete it + milestones.
    const [remaining] = await sql`
      SELECT count(*) AS cnt FROM concept_excerpts WHERE excerpt_id = ${excerpt_id}
    `;
    let excerpt_deleted = false;
    if (parseInt(remaining.cnt) === 0) {
      const [exc] = await sql`SELECT source_id FROM excerpts WHERE id = ${excerpt_id}`;
      if (exc) {
        const [src] = await sql`SELECT content FROM sources WHERE id = ${exc.source_id}`;
        if (src?.content) {
          const cleaned = removeMilestones(src.content, excerpt_id);
          if (cleaned !== src.content) {
            await sql`UPDATE sources SET content = ${cleaned} WHERE id = ${exc.source_id}`;
          }
        }
      }
      await sql`DELETE FROM excerpts WHERE id = ${excerpt_id}`;
      excerpt_deleted = true;
    }

    await logActivity(user.id, "unlink_excerpt", "concept", concept_id, { excerpt_id });
    return json({ ok: true, excerpt_deleted });
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

  // DELETE — admin only. Deletes concept and orphaned excerpts (those with no remaining concepts).
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("ID requerido");
    if (!(await isAdmin(user.id))) {
      return error("Solo administradores pueden eliminar conceptos", 403);
    }

    // Find all excerpts linked to this concept
    const linkedExcerpts = await sql`
      SELECT e.id, e.source_id FROM concept_excerpts ce
      JOIN excerpts e ON e.id = ce.excerpt_id
      WHERE ce.concept_id = ${id}
    `;

    // Delete the concept (CASCADE removes concept_excerpts rows)
    await sql`DELETE FROM concepts WHERE id = ${id}`;

    // Now check which excerpts became orphans (0 concepts remaining)
    let orphansDeleted = 0;
    for (const exc of linkedExcerpts) {
      const [remaining] = await sql`
        SELECT count(*) AS cnt FROM concept_excerpts WHERE excerpt_id = ${exc.id}
      `;
      if (parseInt(remaining.cnt) === 0) {
        // Orphan: remove milestones from source and delete excerpt
        const [src] = await sql`SELECT content FROM sources WHERE id = ${exc.source_id}`;
        if (src?.content) {
          const cleaned = removeMilestones(src.content, exc.id);
          if (cleaned !== src.content) {
            await sql`UPDATE sources SET content = ${cleaned} WHERE id = ${exc.source_id}`;
          }
        }
        await sql`DELETE FROM excerpts WHERE id = ${exc.id}`;
        orphansDeleted++;
      }
    }

    await logActivity(user.id, "delete_concept", "concept", id, {
      linked_excerpts: linkedExcerpts.length,
      orphans_deleted: orphansDeleted
    });
    return json({
      ok: true,
      linked_excerpts: linkedExcerpts.length,
      orphans_deleted: orphansDeleted
    });
  }

  return error("Método no soportado", 405);
};
