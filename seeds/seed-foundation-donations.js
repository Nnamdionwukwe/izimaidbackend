// seeds/seed-foundation-donations.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const DONATION_AMOUNTS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const DONATION_TYPES = ["once", "monthly"];
const STATUSES = ["pending", "completed", "failed", "refunded"];
const PAYMENT_METHODS = ["paystack", "bank_transfer", "card"];

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
  "Chioma",
  "Anthony",
  "Folake",
  "James",
  "Oluwaseun",
  "Patience",
  "Ruth",
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
  "Lawal",
];

const MESSAGES = [
  "I'm so happy to support this wonderful cause.",
  "God bless the work you're doing.",
  "Every family deserves a clean home.",
  "Keep up the great work!",
  "In memory of my mother who loved a clean home.",
  "Thank you for helping those in need.",
  "I believe in the power of community.",
  "This is such an important mission.",
  "Proud to support the foundation.",
  "Let's make Nigeria cleaner together!",
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
  // Weighted towards smaller amounts
  const weights = [0.3, 0.25, 0.2, 0.1, 0.07, 0.05, 0.02, 0.01];
  let r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) {
      return DONATION_AMOUNTS[i];
    }
  }
  return DONATION_AMOUNTS[DONATION_AMOUNTS.length - 1];
}

function getRandomStatus() {
  const weights = [0.4, 0.4, 0.1, 0.1];
  const r = Math.random();
  if (r < 0.4) return "completed";
  if (r < 0.8) return "pending";
  if (r < 0.9) return "failed";
  return "refunded";
}

function getRandomPaymentMethod() {
  const weights = [0.6, 0.25, 0.15];
  const r = Math.random();
  if (r < 0.6) return "paystack";
  if (r < 0.85) return "card";
  return "bank_transfer";
}

function generatePaymentReference() {
  return `FD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`;
}

async function checkTableExists() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'foundation_donations'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedFoundationDonations() {
  console.log("🌱 Seeding foundation donations...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: foundation_donations table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-foundation-migration.js\n");
    process.exit(1);
  }

  const isDryRun = process.argv.includes("--dry-run");
  const shouldClear = process.argv.includes("--clear");
  const numDonations =
    parseInt(
      process.argv.find((arg) => arg.includes("--count="))?.split("=")[1],
    ) || 50;

  console.log(`Mode: ${isDryRun ? "DRY RUN" : "COMMIT"}`);
  console.log(`Clear existing: ${shouldClear ? "YES" : "NO"}`);
  console.log(`Number of donations: ${numDonations}`);

  const donations = [];

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);

  console.log(`\n📝 Generating ${numDonations} donations...`);

  for (let i = 0; i < numDonations; i++) {
    const firstName = getRandomItem(FIRST_NAMES);
    const lastName = getRandomItem(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`;
    const message = Math.random() > 0.6 ? getRandomItem(MESSAGES) : null;
    const amount = getRandomAmount();
    const donationType = getRandomItem(DONATION_TYPES);
    const status = getRandomStatus();
    const paymentMethod = getRandomPaymentMethod();
    const paymentReference = generatePaymentReference();
    const transactionId = `TXN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`;

    const createdDate = getRandomDate(startDate, endDate);
    let completedAt = null;
    if (status === "completed") {
      completedAt = new Date(
        createdDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000,
      );
    }

    let adminNotes = null;
    if (status !== "pending") {
      const noteOptions = [
        "Donation verified and processed.",
        "Followed up with donor via email.",
        "Thank you email sent.",
        "Receipt generated and sent.",
        "Donor added to monthly giving program.",
        "Special thank you note sent.",
      ];
      adminNotes = getRandomItem(noteOptions);
    }

    donations.push({
      donor_name: fullName,
      donor_email: email,
      donor_message: message,
      amount,
      donation_type: donationType,
      status,
      payment_reference: paymentReference,
      payment_method: paymentMethod,
      transaction_id: transactionId,
      admin_notes: adminNotes,
      completed_at: completedAt,
      created_at: createdDate,
      updated_at: createdDate,
    });
  }

  console.log(`✅ Generated ${donations.length} donations`);

  if (isDryRun) {
    console.log("\n📋 Sample of generated donations (first 10):");
    donations.slice(0, 10).forEach((donation, i) => {
      console.log(
        `${(i + 1).toString().padEnd(3)} ${donation.donor_name.padEnd(25)} | ₦${donation.amount.toLocaleString().padEnd(10)} | ${donation.status.padEnd(10)} | ${donation.donation_type}`,
      );
    });

    const statusCount = {};
    const totalAmount = donations.reduce((sum, d) => sum + d.amount, 0);
    donations.forEach((d) => {
      statusCount[d.status] = (statusCount[d.status] || 0) + 1;
    });
    console.log("\n📊 Expected distribution:");
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(
        `   ${status.padEnd(10)}: ${count} (${Math.round((count / donations.length) * 100)}%)`,
      );
    });
    console.log(`\n💰 Total donation amount: ₦${totalAmount.toLocaleString()}`);
    console.log(
      `📊 Average donation: ₦${Math.round(totalAmount / donations.length).toLocaleString()}`,
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
      console.log("🧹 Clearing existing donations...");
      const { rowCount } = await client.query(
        "DELETE FROM foundation_donations",
      );
      console.log(`   Removed ${rowCount} existing donations`);
    }

    let inserted = 0;
    let failed = 0;

    for (const donation of donations) {
      const query = `
        INSERT INTO foundation_donations (
          donor_name, donor_email, donor_message, amount, donation_type,
          status, payment_reference, payment_method, transaction_id,
          admin_notes, completed_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `;

      const values = [
        donation.donor_name,
        donation.donor_email,
        donation.donor_message,
        donation.amount,
        donation.donation_type,
        donation.status,
        donation.payment_reference,
        donation.payment_method,
        donation.transaction_id,
        donation.admin_notes,
        donation.completed_at,
        donation.created_at,
        donation.updated_at,
      ];

      try {
        await client.query(query, values);
        inserted++;
        if (inserted % 20 === 0) {
          console.log(
            `📝 Inserted ${inserted}/${donations.length} donations...`,
          );
        }
      } catch (err) {
        failed++;
        console.error(
          `❌ Failed to insert donation: ${donation.donor_email}`,
          err.message,
        );
        throw err;
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ Successfully seeded ${inserted} foundation donations!`);
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} donations`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count, SUM(amount) as total
      FROM foundation_donations 
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
    console.error("❌ Error seeding donations:", error);
  } finally {
    client.release();
    await db.end();
  }
}

seedFoundationDonations().catch(console.error);
