export const listMaids = async (req, res) => {
  const {
    location,
    service,
    min_rate,
    max_rate,
    page = 1,
    limit = 20,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = ["mp.is_available = true", "u.is_active = true"];
  const params = [];

  if (location) {
    params.push(`%${location}%`);
    conditions.push(`mp.location ILIKE $${params.length}`);
  }
  if (service) {
    params.push(service);
    conditions.push(`$${params.length} = ANY(mp.services)`);
  }
  if (min_rate) {
    params.push(Number(min_rate));
    conditions.push(`mp.hourly_rate >= $${params.length}`);
  }
  if (max_rate) {
    params.push(Number(max_rate));
    conditions.push(`mp.hourly_rate <= $${params.length}`);
  }

  const where = conditions.join(" AND ");
  const filterParams = [...params];
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT u.id, u.name, u.avatar,
              mp.bio, mp.hourly_rate, mp.years_exp,
              mp.services, mp.location, mp.rating, mp.total_reviews
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE ${where}
       ORDER BY mp.rating DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE ${where}`,
      filterParams,
    );

    return res.json({
      maids: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[maids.controller/listMaids]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMaid = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT u.id, u.name, u.avatar, u.created_at as member_since,
              mp.bio, mp.hourly_rate, mp.years_exp, mp.services,
              mp.location, mp.is_available, mp.rating, mp.total_reviews
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE u.id = $1 AND u.is_active = true`,
      [req.params.id],
    );

    if (!rows.length) return res.status(404).json({ error: "maid not found" });
    return res.json({ maid: rows[0] });
  } catch (err) {
    console.error("[maids.controller/getMaid]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateProfile = async (req, res) => {
  const { bio, hourly_rate, years_exp, services, location, is_available } =
    req.body;

  const fields = [];
  const params = [];

  if (bio !== undefined) {
    params.push(bio);
    fields.push(`bio = $${params.length}`);
  }
  if (hourly_rate !== undefined) {
    params.push(hourly_rate);
    fields.push(`hourly_rate = $${params.length}`);
  }
  if (years_exp !== undefined) {
    params.push(years_exp);
    fields.push(`years_exp = $${params.length}`);
  }
  if (services !== undefined) {
    params.push(services);
    fields.push(`services = $${params.length}`);
  }
  if (location !== undefined) {
    params.push(location);
    fields.push(`location = $${params.length}`);
  }
  if (is_available !== undefined) {
    params.push(is_available);
    fields.push(`is_available = $${params.length}`);
  }

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });

  params.push(req.user.id);

  try {
    const { rows } = await req.db.query(
      `UPDATE maid_profiles SET ${fields.join(", ")}
       WHERE user_id = $${params.length} RETURNING *`,
      params,
    );

    if (!rows.length)
      return res.status(404).json({ error: "profile not found" });
    return res.json({ profile: rows[0] });
  } catch (err) {
    console.error("[maids.controller/updateProfile]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMaidReviews = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT r.rating, r.comment, r.created_at,
              u.name as customer_name, u.avatar as customer_avatar
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       WHERE r.maid_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, Number(limit), offset],
    );

    return res.json({ reviews: rows });
  } catch (err) {
    console.error("[maids.controller/getMaidReviews]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
