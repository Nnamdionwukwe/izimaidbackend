import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export function requireAuth(req, res, next) {
  // Debug logging
  console.log("🔐 [AUTH] JWT_SECRET set:", !!JWT_SECRET);
  if (!JWT_SECRET) {
    console.error("❌ [AUTH] JWT_SECRET is NOT set in .env file!");
  }

  const header = req.headers.authorization;
  console.log("📍 [AUTH] Authorization header:", header?.slice(0, 50) + "...");

  if (!header?.startsWith("Bearer ")) {
    console.error("❌ [AUTH] No Bearer token in header");
    return res
      .status(401)
      .json({ error: "missing or invalid authorization header" });
  }

  const token = header.slice(7);
  console.log("🔑 [AUTH] Token preview:", token.slice(0, 50) + "...");

  try {
    console.log("✅ [AUTH] Verifying token with JWT_SECRET...");
    req.user = jwt.verify(token, JWT_SECRET);
    console.log(
      "✅ [AUTH] Token verified! User ID:",
      req.user.id,
      "| Role:",
      req.user.role,
    );
    next();
  } catch (err) {
    console.error("❌ [AUTH] Token verification failed:", err.message);
    return res.status(401).json({ error: "invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    console.log("🛡️ [ROLE] Required roles:", roles, "| User role:", userRole);

    if (!roles.includes(userRole)) {
      console.error(
        "❌ [ROLE] User role forbidden. Has:",
        userRole,
        "Needs:",
        roles,
      );
      return res.status(403).json({ error: "forbidden" });
    }

    console.log("✅ [ROLE] Role authorized");
    next();
  };
}
