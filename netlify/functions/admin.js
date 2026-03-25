import { getDb } from "./utils/db.js";
import { requireAuth, isAdmin, json, error } from "./utils/auth.js";

/**
 * Admin-only endpoints
 * GET  /api/admin/users              — list all users
 * PUT  /api/admin/users              — change user role
 * GET  /api/admin/activity           — activity log
 * GET  /api/admin/stats              — corpus stats
 */
export default async (req, context) => {
  const { user, err } = requireAuth(context);
  if (err) return err;

  if (!(await isAdmin(user.id))) {
    return error("Acceso denegado", 403);
  }

  const sql = getDb();
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/admin", "");

  // GET /api/admin/users
  if (req.method === "GET" && path === "/users") {
    const users = await sql`
      SELECT u.*,
        (SELECT count(*) FROM excerpts WHERE created_by = u.id) AS excerpt_count,
        (SELECT count(*) FROM concepts WHERE created_by = u.id) AS concept_count
      FROM users u ORDER BY u.created_at
    `;
    return json(users);
  }

  // PUT /api/admin/users — change role
  if (req.method === "PUT" && path === "/users") {
    const { id: userId, role } = await req.json();
    if (!userId || !["user", "admin"].includes(role)) {
      return error("user_id y role ('user'|'admin') requeridos");
    }
    const [updated] = await sql`
      UPDATE users SET role = ${role} WHERE id = ${userId} RETURNING *
    `;
    if (!updated) return error("Usuario no encontrado", 404);
    return json(updated);
  }

  // GET /api/admin/activity
  if (req.method === "GET" && path === "/activity") {
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const userId = url.searchParams.get("user_id");
    let rows;
    if (userId) {
      rows = await sql`
        SELECT a.*, u.name AS user_name
        FROM activity_log a
        JOIN users u ON u.id = a.user_id
        WHERE a.user_id = ${userId}
        ORDER BY a.created_at DESC LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT a.*, u.name AS user_name
        FROM activity_log a
        JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT ${limit}
      `;
    }
    return json(rows);
  }

  // GET /api/admin/stats
  if (req.method === "GET" && path === "/stats") {
    const [stats] = await sql`
      SELECT
        (SELECT count(*) FROM sources) AS source_count,
        (SELECT count(*) FROM excerpts) AS excerpt_count,
        (SELECT count(*) FROM concepts) AS concept_count,
        (SELECT count(*) FROM themes) AS theme_count,
        (SELECT count(*) FROM users) AS user_count
    `;
    return json(stats);
  }

  return error("Ruta no encontrada", 404);
};
