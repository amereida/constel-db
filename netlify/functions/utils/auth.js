import { getDb } from "./db.js";

/**
 * Extract user from request.
 *
 * Netlify Functions v2 does NOT auto-populate clientContext.user.
 * We decode the JWT from the Authorization header manually.
 * The JWT is signed by Netlify Identity — in production, Netlify
 * validates it at the edge before the function runs.
 *
 * In local dev, falls back to DEV_USER_* env vars.
 */
export function getUser(context, req) {
  // Try clientContext first (v1 compat / netlify dev)
  const ctxUser = context?.clientContext?.user;
  if (ctxUser) {
    return {
      id: ctxUser.sub,
      email: ctxUser.email,
      name: ctxUser.user_metadata?.full_name || ctxUser.email,
      avatar_url: ctxUser.user_metadata?.avatar_url || null,
    };
  }

  // v2: decode JWT from Authorization header
  if (req) {
    const authHeader = req.headers.get?.("authorization") || req.headers?.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        // Decode payload (base64url) — we trust Netlify edge to validate signature
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload.sub && payload.email) {
          return {
            id: payload.sub,
            email: payload.email,
            name: payload.user_metadata?.full_name || payload.email,
            avatar_url: payload.user_metadata?.avatar_url || null,
          };
        }
      } catch (e) {
        console.error("JWT decode error:", e.message);
      }
    }
  }

  // Dev fallback
  if (process.env.CONTEXT !== "production" && process.env.DEV_USER_EMAIL) {
    return {
      id: process.env.DEV_USER_ID || "dev_local_admin",
      email: process.env.DEV_USER_EMAIL,
      name: process.env.DEV_USER_NAME || "Dev Admin",
      avatar_url: null,
    };
  }

  return null;
}

/**
 * Ensure user exists in DB (upsert on login).
 */
export async function ensureUser(user) {
  const sql = getDb();

  // Check if a user with this email exists under a different ID (e.g. from seed data).
  // If so, migrate ownership to the Identity ID.
  const [existing] = await sql`SELECT id, role FROM users WHERE email = ${user.email}`;
  if (existing && existing.id !== user.id) {
    // 1. Insert the new user first (so FK references are valid)
    await sql`
      INSERT INTO users (id, email, name, avatar_url, role, last_login_at)
      VALUES (${user.id}, ${user.email}, ${user.name}, ${user.avatar_url}, ${existing.role || 'user'}, now())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email, name = EXCLUDED.name,
        avatar_url = EXCLUDED.avatar_url, last_login_at = now()
    `;
    // 2. Migrate all FK references from old ID to new ID
    await sql`UPDATE sources SET uploaded_by = ${user.id} WHERE uploaded_by = ${existing.id}`;
    await sql`UPDATE excerpts SET created_by = ${user.id} WHERE created_by = ${existing.id}`;
    await sql`UPDATE concepts SET created_by = ${user.id} WHERE created_by = ${existing.id}`;
    await sql`UPDATE themes SET created_by = ${user.id} WHERE created_by = ${existing.id}`;
    await sql`UPDATE notes SET created_by = ${user.id} WHERE created_by = ${existing.id}`;
    await sql`UPDATE concept_excerpts SET linked_by = ${user.id} WHERE linked_by = ${existing.id}`;
    await sql`UPDATE theme_concepts SET added_by = ${user.id} WHERE added_by = ${existing.id}`;
    await sql`UPDATE activity_log SET user_id = ${user.id} WHERE user_id = ${existing.id}`;
    // 3. Delete the old user record
    await sql`DELETE FROM users WHERE id = ${existing.id}`;
    // Return the migrated user
    const [row] = await sql`SELECT * FROM users WHERE id = ${user.id}`;
    return row;
  }

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
export function requireAuth(context, req) {
  const user = getUser(context, req);
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
