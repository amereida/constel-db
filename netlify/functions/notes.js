import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error, logActivity } from "./utils/auth.js";

/**
 * GET    /api/notes?theme_id=X            — notes for a theme
 * GET    /api/notes?concept_id=X          — notes for a concept
 * POST   /api/notes                       — create note
 * PUT    /api/notes                       — update (own or admin)
 * DELETE /api/notes?id=X                  — delete (own or admin)
 */
export default async (req, context) => {
  const sql = getDb();
  const url = new URL(req.url);

  // GET — public (no auth required)
  if (req.method === "GET") {
    const themeId = url.searchParams.get("theme_id");
    const conceptId = url.searchParams.get("concept_id");

    if (themeId) {
      const notes = await sql`
        SELECT n.*, u.name AS created_by_name
        FROM notes n
        LEFT JOIN users u ON u.id = n.created_by
        WHERE n.theme_id = ${themeId}
        ORDER BY n.created_at
      `;
      return json(notes);
    }

    if (conceptId) {
      const notes = await sql`
        SELECT n.*, u.name AS created_by_name
        FROM notes n
        LEFT JOIN users u ON u.id = n.created_by
        WHERE n.concept_id = ${conceptId}
        ORDER BY n.created_at
      `;
      return json(notes);
    }

    return error("theme_id o concept_id requerido");
  }

  // Auth required for mutations
  const { user, err } = requireAuth(context);
  if (err) return err;

  // POST
  if (req.method === "POST") {
    const { theme_id, concept_id, text } = await req.json();
    if (!text?.trim()) return error("text requerido");
    if (!theme_id && !concept_id) return error("theme_id o concept_id requerido");
    const [note] = await sql`
      INSERT INTO notes (theme_id, concept_id, text, created_by)
      VALUES (${theme_id || null}, ${concept_id || null}, ${text.trim()}, ${user.id})
      RETURNING *
    `;
    await logActivity(user.id, "create_note", "note", note.id, { theme_id, concept_id });
    return json(note, 201);
  }

  // PUT
  if (req.method === "PUT") {
    const { id: nid, text } = await req.json();
    if (!nid || !text?.trim()) return error("ID y text requeridos");

    const [note] = await sql`SELECT * FROM notes WHERE id = ${nid}`;
    if (!note) return error("Nota no encontrada", 404);
    if (note.created_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes editar tus propias notas", 403);
    }

    const [updated] = await sql`
      UPDATE notes SET text = ${text.trim()}, updated_at = now()
      WHERE id = ${nid} RETURNING *
    `;
    await logActivity(user.id, "update_note", "note", nid);
    return json(updated);
  }

  // DELETE
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("ID requerido");

    const [note] = await sql`SELECT * FROM notes WHERE id = ${id}`;
    if (!note) return error("Nota no encontrada", 404);
    if (note.created_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes eliminar tus propias notas", 403);
    }

    await sql`DELETE FROM notes WHERE id = ${id}`;
    await logActivity(user.id, "delete_note", "note", id);
    return json({ ok: true });
  }

  return error("Método no soportado", 405);
};
