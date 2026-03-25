import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error, logActivity } from "./utils/auth.js";

/**
 * GET  /api/sources         — list all sources (metadata only)
 * GET  /api/sources?id=X    — get source with full content
 * POST /api/sources         — create source (admin only)
 * PUT  /api/sources         — update source (admin only)
 * DELETE /api/sources?id=X  — delete source (admin only)
 */
export default async (req, context) => {
  const sql = getDb();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  // GET — public (no auth required)
  if (req.method === "GET") {
    if (id) {
      const [source] = await sql`SELECT * FROM sources WHERE id = ${id}`;
      if (!source) return error("Fuente no encontrada", 404);
      return json(source);
    }
    // List without content (lighter)
    const sources = await sql`
      SELECT s.id, s.filename, s.title, s.author, s.date, s.word_count, s.uploaded_by, s.created_at, s.updated_at,
             (SELECT count(*) FROM excerpts e WHERE e.source_id = s.id) AS excerpt_count
      FROM sources s ORDER BY s.date, s.title
    `;
    return json(sources);
  }

  // Auth required for mutations
  const { user, err } = requireAuth(context, req);
  if (err) return err;

  // Admin-only from here
  if (!(await isAdmin(user.id))) {
    return error("Solo administradores pueden gestionar fuentes", 403);
  }

  // POST — create
  if (req.method === "POST") {
    const body = await req.json();
    const { filename, title, author, date, content } = body;
    if (!content) return error("Contenido requerido");
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const [source] = await sql`
      INSERT INTO sources (filename, title, author, date, content, word_count, uploaded_by)
      VALUES (${filename || ""}, ${title || ""}, ${author || ""}, ${date || ""}, ${content}, ${wordCount}, ${user.id})
      RETURNING *
    `;
    await logActivity(user.id, "create_source", "source", source.id);
    return json(source, 201);
  }

  // PUT — update
  if (req.method === "PUT") {
    const body = await req.json();
    const { id: srcId, title, author, date, content } = body;
    if (!srcId) return error("ID requerido");
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (author !== undefined) updates.author = author;
    if (date !== undefined) updates.date = date;
    if (content !== undefined) {
      updates.content = content;
      updates.word_count = content.split(/\s+/).filter(Boolean).length;
    }
    const [source] = await sql`
      UPDATE sources SET ${sql(updates)}, updated_at = now()
      WHERE id = ${srcId} RETURNING *
    `;
    if (!source) return error("Fuente no encontrada", 404);
    await logActivity(user.id, "update_source", "source", srcId);
    return json(source);
  }

  // DELETE
  if (req.method === "DELETE") {
    if (!id) return error("ID requerido");
    await sql`DELETE FROM sources WHERE id = ${id}`;
    await logActivity(user.id, "delete_source", "source", id);
    return json({ ok: true });
  }

  return error("Método no soportado", 405);
};
