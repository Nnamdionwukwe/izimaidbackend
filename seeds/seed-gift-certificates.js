// seeds/seed-gift-certificates.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const OCCASIONS = [
  "Birthday",
  "Wedding",
  "New Home",
  "New Baby",
  "Work Milestone",
  "Christmas",
  "Valentine's",
  "Mother's Day",
  "Graduation",
  "Get Well",
];

const STATUSES = ["active", "redeemed", "expired", "cancelled"];

const FIRST_NAMES = [
  "Amaka",
  "Oluwatobi",
  "Fatima",
  "Chinedu",
  "Blessing",
  "Emeka",
  "Ngozi",
  "Ibrahim",
  "Grace",
  "Victor",
  "Esther",
  "Michael",
  "Joy",
  "Peter",
  "Mercy",
  "David",
  "Peace",
  "Samuel",
];

const LAST_NAMES = [
  "Okoye",
  "Balogun",
  "Abdullahi",
  "Eze",
  "Okafor",
  "Mohammed",
  "Nwosu",
  "Adekunle",
  "Oyedele",
  "Uche",
  "Bello",
  "Adepoju",
  "Ogunsanya",
  "Ibrahim",
  "Ogunleye",
  "Aliyu",
  "Onyeka",
];

const MESSAGES = [
  "Happy birthday! Enjoy a clean home on us.",
  "Congratulations on your new home!",
  "Welcome to the neighborhood!",
  "Wishing you a fresh start.",
  "You deserve a break. Enjoy!",
  "Congratulations on your milestone!",
  "Merry Christmas!",
  "Happy Valentine's Day!",
  "You're amazing! Enjoy this gift.",
  "A little treat for you.",
];

function getRandomDate(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const randomTime =
    start.getTime() + Math.random() * (end.getTime() - start.getTime());
  return new Date(randomTime);
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomAmount() {
  const amounts = [5000, 9000, 10000, 15000, 20000, 25000, 35000, 40000, 50000];
  return amounts[Math.floor(Math.random() * amounts.length)];
}

function generateCode() {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    parts.push(Math.random().toString(36).substring(2, 6).toUpperCase());
  }
  return `DSPK-${parts.join("-")}`;
}

function generatePurchaseReference() {
  return `GIFT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`;
}

async function checkTableExists() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'gift_certificates'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedGiftCertificates() {
  console.log("🌱 Seeding gift certificates...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: gift_certificates table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-gift-certificate-migration.js\n");
    process.exit(1);
  }

  const isDryRun = process.argv.includes("--dry-run");
  const shouldClear = process.argv.includes("--clear");
  const numCertificates =
    parseInt(
      process.argv.find((arg) => arg.includes("--count="))?.split("=")[1],
    ) || 50;

  console.log(`Mode: ${isDryRun ? "DRY RUN" : "COMMIT"}`);
  console.log(`Clear existing: ${shouldClear ? "YES" : "NO"}`);
  console.log(`Number of certificates: ${numCertificates}`);

  const certificates = [];

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);

  console.log(`\n📝 Generating ${numCertificates} certificates...`);

  for (let i = 0; i < numCertificates; i++) {
    const firstName = getRandomItem(FIRST_NAMES);
    const lastName = getRandomItem(LAST_NAMES);
    const fromName = `${firstName} ${lastName}`;

    const recipientFirstName = getRandomItem(FIRST_NAMES);
    const recipientLastName = getRandomItem(LAST_NAMES);
    const recipientName = `${recipientFirstName} ${recipientLastName}`;
    const recipientEmail = `${recipientFirstName.toLowerCase()}.${recipientLastName.toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`;

    const amount = getRandomAmount();
    const occasion = getRandomItem(OCCASIONS);
    const message = Math.random() > 0.5 ? getRandomItem(MESSAGES) : null;

    const createdDate = getRandomDate(startDate, endDate);
    const expiresAt = new Date(createdDate);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const certificateCode = generateCode();
    const purchaseReference = generatePurchaseReference();

    let status;
    const randomWeight = Math.random();
    if (randomWeight < 0.5) status = "active";
    else if (randomWeight < 0.75) status = "redeemed";
    else if (randomWeight < 0.9) status = "expired";
    else status = "cancelled";

    let redeemedAt = null;
    let redeemedBy = null;
    let bookingId = null;

    if (status === "redeemed") {
      redeemedAt = new Date(
        createdDate.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000,
      );
      redeemedBy = Math.floor(Math.random() * 100) + 1;
      bookingId = Math.floor(Math.random() * 1000) + 1;
    }

    let adminNotes = null;
    if (status !== "active") {
      const noteOptions = [
        "Certificate purchased and sent.",
        "Recipient notified via email.",
        "Followed up with recipient.",
        "Certificate redeemed successfully.",
        "Expired certificate - auto-expired.",
        "Cancelled by admin.",
      ];
      adminNotes = getRandomItem(noteOptions);
    }

    certificates.push({
      certificate_code: certificateCode,
      amount,
      from_name: fromName,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      message: message,
      delivery_date: createdDate,
      occasion,
      status,
      purchase_reference: purchaseReference,
      payment_method: "paystack",
      transaction_id: `TXN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`,
      redeemed_at: redeemedAt,
      redeemed_by: redeemedBy,
      booking_id: bookingId,
      expires_at: expiresAt,
      admin_notes: adminNotes,
      created_at: createdDate,
      updated_at: createdDate,
    });
  }

  console.log(`✅ Generated ${certificates.length} certificates`);

  if (isDryRun) {
    console.log("\n📋 Sample of generated certificates (first 10):");
    certificates.slice(0, 10).forEach((cert, i) => {
      console.log(
        `${(i + 1).toString().padEnd(3)} ${cert.certificate_code.padEnd(18)} | ${cert.from_name.padEnd(25)} → ${cert.recipient_name.padEnd(25)} | ₦${cert.amount.toLocaleString().padEnd(10)} | ${cert.status}`,
      );
    });

    const statusCount = {};
    const totalAmount = certificates.reduce((sum, c) => sum + c.amount, 0);
    certificates.forEach((c) => {
      statusCount[c.status] = (statusCount[c.status] || 0) + 1;
    });
    console.log("\n📊 Expected distribution:");
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(
        `   ${status.padEnd(10)}: ${count} (${Math.round((count / certificates.length) * 100)}%)`,
      );
    });
    console.log(
      `\n💰 Total certificate value: ₦${totalAmount.toLocaleString()}`,
    );
    console.log(
      `📊 Average certificate: ₦${Math.round(totalAmount / certificates.length).toLocaleString()}`,
    );

    console.log(
      "\n✨ Dry run completed. Run without --dry-run to seed the database.",
    );
    await db.end();
    return;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    if (shouldClear) {
      console.log("🧹 Clearing existing certificates...");
      const { rowCount } = await client.query("DELETE FROM gift_certificates");
      console.log(`   Removed ${rowCount} existing certificates`);
    }

    let inserted = 0;
    let failed = 0;

    for (const cert of certificates) {
      const query = `
        INSERT INTO gift_certificates (
          certificate_code, amount, from_name, recipient_name,
          recipient_email, message, delivery_date, occasion,
          status, purchase_reference, payment_method, transaction_id,
          redeemed_at, redeemed_by, booking_id, expires_at,
          admin_notes, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `;

      const values = [
        cert.certificate_code,
        cert.amount,
        cert.from_name,
        cert.recipient_name,
        cert.recipient_email,
        cert.message,
        cert.delivery_date,
        cert.occasion,
        cert.status,
        cert.purchase_reference,
        cert.payment_method,
        cert.transaction_id,
        cert.redeemed_at,
        cert.redeemed_by,
        cert.booking_id,
        cert.expires_at,
        cert.admin_notes,
        cert.created_at,
        cert.updated_at,
      ];

      try {
        await client.query(query, values);
        inserted++;
        if (inserted % 20 === 0) {
          console.log(
            `📝 Inserted ${inserted}/${certificates.length} certificates...`,
          );
        }
      } catch (err) {
        failed++;
        console.error(
          `❌ Failed to insert certificate: ${cert.certificate_code}`,
          err.message,
        );
        throw err;
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ Successfully seeded ${inserted} gift certificates!`);
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} certificates`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count, SUM(amount) as total
      FROM gift_certificates 
      GROUP BY status 
      ORDER BY count DESC
    `);

    if (stats.length > 0) {
      console.log("\n📊 Summary by status:");
      stats.forEach((stat) => {
        const percentage = Math.round((stat.count / inserted) * 100);
        console.log(
          `   ${stat.status.padEnd(10)}: ${stat.count} (${percentage}%) - ₦${Number(stat.total).toLocaleString()}`,
        );
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding certificates:", error);
  } finally {
    client.release();
    await db.end();
  }
}

seedGiftCertificates().catch(console.error);
