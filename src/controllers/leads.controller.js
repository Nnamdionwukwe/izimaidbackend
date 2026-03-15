export const createLead = async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    textMeMessages,
    zipCode,
    servicesAddress,
    apartmentOrSuite,
    cleaningType = "residential",
    frequency = "recurring",
    residentialHomeSquareFeet,
    selectBedRoomsValue,
    selectBathRoomsValue,
    lightCommercialRecurring,
    lightCommercialOfficeSquareFeet,
    lightCommercialSelectedOfficeValue,
    lightCommercialSelectedOfficeBathRoomsValue,
    lightCommercialOneTimeClean,
  } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!firstName) missing.push("firstName");
  if (!lastName) missing.push("lastName");
  if (!email) missing.push("email");
  if (!phoneNumber) missing.push("phoneNumber");
  if (!zipCode) missing.push("zipCode");
  if (!servicesAddress) missing.push("servicesAddress");

  if (missing.length) {
    return res
      .status(400)
      .json({ error: "missing required fields", fields: missing });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "invalid email address" });
  }

  try {
    const { rows } = await req.db.query(
      `INSERT INTO leads (
        first_name, last_name, email, phone_number, text_me_messages,
        zip_code, service_address, apartment_suite,
        cleaning_type, frequency,
        residential_sqft, bedrooms, bathrooms, recurring_plan,
        commercial_sqft, offices, commercial_bathrooms,
        commercial_frequency, is_move_in_out
      ) VALUES (
        $1,  $2,  $3,  $4,  $5,
        $6,  $7,  $8,
        $9,  $10,
        $11, $12, $13, $14,
        $15, $16, $17,
        $18, $19
      ) RETURNING *`,
      [
        firstName,
        lastName,
        email,
        phoneNumber,
        textMeMessages === "Yes send me service reminders" ||
          textMeMessages === true,
        zipCode,
        servicesAddress,
        apartmentOrSuite || null,
        cleaningType === "light_commercial"
          ? "light_commercial"
          : "residential",
        ["one_time", "move_in_out"].includes(frequency)
          ? frequency
          : "recurring",
        residentialHomeSquareFeet || null,
        selectBedRoomsValue !== "" && selectBedRoomsValue !== undefined
          ? Number(selectBedRoomsValue)
          : null,
        selectBathRoomsValue !== "" && selectBathRoomsValue !== undefined
          ? Number(selectBathRoomsValue)
          : null,
        lightCommercialRecurring || null,
        lightCommercialOfficeSquareFeet || null,
        lightCommercialSelectedOfficeValue !== "" &&
        lightCommercialSelectedOfficeValue !== undefined
          ? Number(lightCommercialSelectedOfficeValue)
          : null,
        lightCommercialSelectedOfficeBathRoomsValue !== "" &&
        lightCommercialSelectedOfficeBathRoomsValue !== undefined
          ? Number(lightCommercialSelectedOfficeBathRoomsValue)
          : null,
        lightCommercialRecurring || null,
        lightCommercialOneTimeClean === "yes",
      ],
    );

    console.log(`[leads] new lead from ${email}`);
    return res.status(201).json({ success: true, lead: rows[0] });
  } catch (err) {
    console.error("[leads.controller/createLead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const listLeads = async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT * FROM leads ${where} ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM leads ${where}`,
      params.slice(0, -2),
    );
    return res.json({
      leads: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[leads.controller/listLeads]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getLead = async (req, res) => {
  try {
    const { rows } = await req.db.query("SELECT * FROM leads WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "lead not found" });
    return res.json({ lead: rows[0] });
  } catch (err) {
    console.error("[leads.controller/getLead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateLeadStatus = async (req, res) => {
  const { status, notes } = req.body;
  const validStatuses = ["new", "contacted", "converted", "lost"];

  if (!validStatuses.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  const fields = ["status = $1"];
  const params = [status];

  if (notes !== undefined) {
    params.push(notes);
    fields.push(`notes = $${params.length}`);
  }
  params.push(req.params.id);

  try {
    const { rows } = await req.db.query(
      `UPDATE leads SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: "lead not found" });
    return res.json({ lead: rows[0] });
  } catch (err) {
    console.error("[leads.controller/updateLeadStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
