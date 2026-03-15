export const createLead = async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    phone,
    zip_code,
    service_address,
    apartment_suite,
    cleaning_type,
    frequency,
    square_feet,
    bedrooms,
    bathrooms,
    offices,
    office_bathrooms,
    move_in_out,
    one_time_clean,
    text_me_messages,
  } = req.body;

  // Validate required fields
  const required = {
    first_name,
    last_name,
    email,
    phone,
    zip_code,
    service_address,
    cleaning_type,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    return res
      .status(400)
      .json({ error: `missing required fields: ${missing.join(", ")}` });
  }

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid email address" });
  }

  // Validate cleaning type
  if (!["residential", "light_commercial"].includes(cleaning_type)) {
    return res
      .status(400)
      .json({ error: "cleaning_type must be residential or light_commercial" });
  }

  try {
    const { rows } = await req.db.query(
      `INSERT INTO leads (
        first_name, last_name, email, phone, zip_code,
        service_address, apartment_suite, cleaning_type,
        frequency, square_feet, bedrooms, bathrooms,
        offices, office_bathrooms, move_in_out,
        one_time_clean, text_me_messages
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17
      ) RETURNING *`,
      [
        first_name,
        last_name,
        email,
        phone,
        zip_code,
        service_address,
        apartment_suite || null,
        cleaning_type,
        frequency || null,
        square_feet || null,
        bedrooms ?? null,
        bathrooms ?? null,
        offices ?? null,
        office_bathrooms ?? null,
        move_in_out ?? false,
        one_time_clean ?? false,
        text_me_messages ?? false,
      ],
    );

    return res
      .status(201)
      .json({
        lead: rows[0],
        message: "Thank you! We will be in touch shortly.",
      });
  } catch (err) {
    console.error("[leads.controller/createLead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// Admin only
export const listLeads = async (req, res) => {
  const { status, cleaning_type, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (cleaning_type) {
    params.push(cleaning_type);
    conditions.push(`cleaning_type = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT * FROM leads ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM leads ${where}`,
      params.slice(0, -2),
    );

    return res.json({ leads: rows, total: Number(countRows[0].count) });
  } catch (err) {
    console.error("[leads.controller/listLeads]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateLeadStatus = async (req, res) => {
  const { status } = req.body;
  const validStatuses = ["new", "contacted", "converted", "lost"];

  if (!validStatuses.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE leads SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, req.params.id],
    );

    if (!rows.length) return res.status(404).json({ error: "lead not found" });
    return res.json({ lead: rows[0] });
  } catch (err) {
    console.error("[leads.controller/updateLeadStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
