import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

export const googleLogin = async (req, res) => {
  const { id_token, role = "customer" } = req.body;

  if (!id_token) {
    return res.status(400).json({ error: "id_token is required" });
  }
  if (!["customer", "maid"].includes(role)) {
    return res.status(400).json({ error: "role must be customer or maid" });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "invalid google token" });
  }

  const { sub: google_id, email, name, picture: avatar } = payload;

  try {
    const { rows } = await req.db.query(
      `INSERT INTO users (email, name, avatar, google_id, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_id) DO UPDATE
         SET name = EXCLUDED.name, avatar = EXCLUDED.avatar
       RETURNING *`,
      [email, name, avatar, google_id, role],
    );

    const user = rows[0];

    if (user.role === "maid") {
      await req.db.query(
        `INSERT INTO maid_profiles (user_id, hourly_rate)
         VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [user.id],
      );
    }

    await req.redis.setEx(
      `user:${user.id}`,
      60 * 60 * 24 * 7,
      JSON.stringify(user),
    );

    return res.status(200).json({ token: signToken(user), user });
  } catch (err) {
    console.error("[auth.controller/googleLogin]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMe = async (req, res) => {
  try {
    const cached = await req.redis.get(`user:${req.user.id}`);
    if (cached) return res.json({ user: JSON.parse(cached) });

    const { rows } = await req.db.query("SELECT * FROM users WHERE id = $1", [
      req.user.id,
    ]);

    if (!rows.length) return res.status(404).json({ error: "user not found" });
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("[auth.controller/getMe]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const logout = async (req, res) => {
  try {
    await req.redis.del(`user:${req.user.id}`);
    return res.json({ message: "logged out" });
  } catch (err) {
    console.error("[auth.controller/logout]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
