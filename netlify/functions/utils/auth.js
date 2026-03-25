import { getDb } from "./db.js";

/**
 * Extract and validate user from Netlify Identity JWT.
 * The JWT is automatically verified by Netlify when using Identity.
 * The `clientContext.identity` and `clientContext.user` are set by Netlify.
 */
export function getUser(context) {
  const user = context?.clientContext?.user;
  if (!user) return null;
  return {
    id: user.sub,
    email: user.email,
    name: user.user_metadata?.full_name || user.email,
    avatar_url: user.user_metadata?.avatar_url || null,
  };
}

/**
 * Ensure user exists in DB (upsert on login).
 */
export async function ensureUser(user) {
  const sql = getDb();
  const [row] = await sql`
    INSERT INTO users (id, email, name, avatar_url, last_login_at)
    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.avatar_url}, now())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      avatar_url = EXCLUDED.avatar_url,
      last_login_at = now()
    RETURNING *
  `;
  return row;
}

/**
 * Check if user has admin role.
 */
export async function isAdmin(userId) {
  const sql = getDb();
  const [row] = await sql`SELECT role FROM users WHERE id = ${userId}`;
  return row?.role === "admin";
}

/**
 * Standard JSON response helper.
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Error response helper.
 */
export function error(message, status = 400) {
  return json({ error: message }, status);
}

/**
 * Require authenticated user or return 401.
 */
export function requireAuth(context) {
  const user = getUser(context);
  if (!user) return { user: null, err: error("No autenticado", 401) };
  return { user, err: null };
}

/**
 * Log an activity.
 */
export async function logActivity(userId, action, entityType, entityId, detail = null) {
  const sql = getDb();
  await sql`
    INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail)
    VALUES (${userId}, ${action}, ${entityType}, ${entityId}, ${detail ? JSON.stringify(detail) : null})
  `;
}
