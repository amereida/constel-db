import { getDb } from "./utils/db.js";
import { getUser, ensureUser, json, error } from "./utils/auth.js";

/**
 * POST /api/auth          — sync user to DB after Identity login
 * GET  /api/auth          — get current user info
 * PUT  /api/auth/profile  — update own name and profile_url
 */
export default async (req, context) => {
  const user = getUser(context, req);
  if (!user) return error("No autenticado", 401);

  const url = new URL(req.url);
  const path = url.pathname.replace("/api/auth", "");

  // PUT /api/auth/profile — update own profile
  if (req.method === "PUT" && path === "/profile") {
    const { name, profile_url } = await req.json();
    const sql = getDb();
    const [updated] = await sql`
      UPDATE users SET
        name = COALESCE(${name || null}, name),
        profile_url = ${profile_url ?? null}
      WHERE id = ${user.id}
      RETURNING id, email, name, avatar_url, role, profile_url
    `;
    if (!updated) return error("Usuario no encontrado", 404);
    return json(updated);
  }

  if (req.method === "POST") {
    const dbUser = await ensureUser(user);
    return json(dbUser);
  }

  // GET
  return json(user);
};
