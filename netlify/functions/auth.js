import { getUser, ensureUser, json, error } from "./utils/auth.js";

/**
 * POST /api/auth — called after Netlify Identity login to sync user to DB
 * GET  /api/auth — get current user info
 */
export default async (req, context) => {
  const user = getUser(context, req);
  if (!user) return error("No autenticado", 401);

  if (req.method === "POST") {
    const dbUser = await ensureUser(user);
    return json(dbUser);
  }

  // GET
  return json(user);
};
