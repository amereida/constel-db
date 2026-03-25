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
  const { user, err } = requireAuth(context);
  if (err) return err;

  const sql = getDb();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  // GET
  if (req.method === "GET") {
    if (id) {
      const [source] = await sql`SELECT * FROM sources WHERE id = ${id}`;
      if (!source) return error("Fuente no encontrada", 404);
      return json(source);
    }
    // List without content (lighter)
    const sources = await sql`
      SELECT id, filename, title, author, date, word_count, uploaded_by, created_at, updated_at
      FROM sources ORDER BY date, title
    `;
    return json(sources);
  }

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
