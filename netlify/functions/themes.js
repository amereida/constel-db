import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error, logActivity } from "./utils/auth.js";

/**
 * GET    /api/themes                      — list all themes with concept counts
 * POST   /api/themes                      — create theme
 * PUT    /api/themes                      — update (rename/recolor, own or admin)
 * DELETE /api/themes?id=X                 — delete (admin only)
 * POST   /api/themes/add-concept          — add concept to theme
 * POST   /api/themes/remove-concept       — remove concept from theme (own link or admin)
 */
export default async (req, context) => {
  const { user, err } = requireAuth(context);
  if (err) return err;

  const sql = getDb();
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/themes", "");

  // POST /api/themes/add-concept
  if (req.method === "POST" && path === "/add-concept") {
    const { theme_id, concept_id } = await req.json();
    if (!theme_id || !concept_id) return error("theme_id y concept_id requeridos");
    await sql`
      INSERT INTO theme_concepts (theme_id, concept_id, added_by)
      VALUES (${theme_id}, ${concept_id}, ${user.id})
      ON CONFLICT DO NOTHING
    `;
    await logActivity(user.id, "add_concept_to_theme", "theme", theme_id, { concept_id });
    return json({ ok: true });
  }

  // POST /api/themes/remove-concept
  if (req.method === "POST" && path === "/remove-concept") {
    const { theme_id, concept_id } = await req.json();
    if (!theme_id || !concept_id) return error("theme_id y concept_id requeridos");

    const [link] = await sql`
      SELECT added_by FROM theme_concepts
      WHERE theme_id = ${theme_id} AND concept_id = ${concept_id}
    `;
    if (!link) return error("Vínculo no encontrado", 404);
    if (link.added_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes quitar tus propios vínculos", 403);
    }

    await sql`
      DELETE FROM theme_concepts
      WHERE theme_id = ${theme_id} AND concept_id = ${concept_id}
    `;
    await logActivity(user.id, "remove_concept_from_theme", "theme", theme_id, { concept_id });
    return json({ ok: true });
  }

  // GET
  if (req.method === "GET") {
    const themes = await sql`
      SELECT t.*,
        u.name AS created_by_name,
        (SELECT count(*) FROM theme_concepts WHERE theme_id = t.id) AS concept_count
      FROM themes t
      LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.label
    `;
    return json(themes);
  }

  // POST — create
  if (req.method === "POST") {
    const { label, color } = await req.json();
    if (!label?.trim()) return error("Label requerido");
    const [theme] = await sql`
      INSERT INTO themes (label, color, created_by)
      VALUES (${label.trim()}, ${color || "#888"}, ${user.id})
      RETURNING *
    `;
    await logActivity(user.id, "create_theme", "theme", theme.id);
    return json(theme, 201);
  }

  // PUT — update
  if (req.method === "PUT") {
    const { id: tid, label, color } = await req.json();
    if (!tid) return error("ID requerido");

    const [theme] = await sql`SELECT * FROM themes WHERE id = ${tid}`;
    if (!theme) return error("Tema no encontrado", 404);
    if (theme.created_by !== user.id && !(await isAdmin(user.id))) {
      return error("Solo puedes editar tus propios temas", 403);
    }

    const updates = {};
    if (label !== undefined) updates.label = label.trim();
    if (color !== undefined) updates.color = color;

    const [updated] = await sql`
      UPDATE themes SET ${sql(updates)}, updated_at = now()
      WHERE id = ${tid} RETURNING *
    `;
    await logActivity(user.id, "update_theme", "theme", tid);
    return json(updated);
  }

  // DELETE — admin only
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("ID requerido");
    if (!(await isAdmin(user.id))) {
      return error("Solo administradores pueden eliminar temas", 403);
    }
    await sql`DELETE FROM themes WHERE id = ${id}`;
    await logActivity(user.id, "delete_theme", "theme", id);
    return json({ ok: true });
  }

  return error("Método no soportado", 405);
};
