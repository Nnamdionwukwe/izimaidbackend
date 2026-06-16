// seeds/seed-contact-messages.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const SUBJECTS = [
  "General Enquiry",
  "Request a Quote",
  "Complaint",
  "Partnership",
  "Other",
];

const STATUSES = ["new", "read", "replied", "resolved", "archived"];

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
  "I need a quote for cleaning my 3-bedroom apartment in Lekki. Please let me know your rates and availability.",
  "I want to book a cleaner for a one-time deep cleaning service. My house is in Abuja.",
  "I have a complaint about the service I received yesterday. The cleaner arrived late and left early.",
  "I'm interested in partnering with Deusizi for my cleaning company. Can we discuss potential collaboration?",
  "Do you offer weekend cleaning services? I work during the week and need someone on Saturdays.",
  "How do I sign up to become a cleaner on your platform? I have 5 years of experience.",
  "I need help with moving out cleaning for my apartment in VI. When can you come?",
  "Can you provide a receipt for my payment? I need it for my records.",
  "Your service was excellent! I want to book a regular weekly cleaner.",
  "I'm having trouble logging into my account. Can someone help me reset my password?",
  "What products do your cleaners use? I prefer eco-friendly cleaning products.",
  "I need a cleaner who can also do laundry and ironing. Do you offer this service?",
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

function getRandomPhone() {
  return `080${Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(7, "0")}`;
}

async function checkTableExists() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'contact_messages'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedContactMessages() {
  console.log("🌱 Seeding contact messages...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: contact_messages table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-contact-migration.js\n");
    process.exit(1);
  }

  const isDryRun = process.argv.includes("--dry-run");
  const shouldClear = process.argv.includes("--clear");
  const numMessages =
    parseInt(
      process.argv.find((arg) => arg.includes("--count="))?.split("=")[1],
    ) || 50;

  console.log(`Mode: ${isDryRun ? "DRY RUN" : "COMMIT"}`);
  console.log(`Clear existing: ${shouldClear ? "YES" : "NO"}`);
  console.log(`Number of messages: ${numMessages}`);

  const messages = [];

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  console.log(`\n📝 Generating ${numMessages} messages...`);

  for (let i = 0; i < numMessages; i++) {
    const firstName = getRandomItem(FIRST_NAMES);
    const lastName = getRandomItem(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`;
    const phone = getRandomPhone();
    const subject = getRandomItem(SUBJECTS);
    const message = getRandomItem(MESSAGES);

    let status;
    const randomWeight = Math.random();
    if (randomWeight < 0.35) status = "new";
    else if (randomWeight < 0.55) status = "read";
    else if (randomWeight < 0.75) status = "replied";
    else if (randomWeight < 0.9) status = "resolved";
    else status = "archived";

    const createdDate = getRandomDate(startDate, endDate);
    const referenceNumber = `CMS-${createdDate.getTime().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    let adminNotes = null;
    let repliedAt = null;
    let repliedBy = null;

    if (status !== "new") {
      const noteOptions = [
        "Customer inquired about pricing.",
        "Followed up with quote.",
        "Scheduled cleaning for next week.",
        "Resolved customer complaint.",
        "Forwarded to team for review.",
        "Sent confirmation email.",
      ];
      adminNotes = getRandomItem(noteOptions);

      if (status === "replied" || status === "resolved") {
        repliedAt = new Date(
          createdDate.getTime() + Math.random() * 2 * 24 * 60 * 60 * 1000,
        );
        repliedBy = "admin";
      }
    }

    messages.push({
      full_name: fullName,
      email,
      phone,
      subject,
      message,
      status,
      admin_notes: adminNotes,
      replied_at: repliedAt,
      replied_by: repliedBy,
      reference_number: referenceNumber,
      created_at: createdDate,
      updated_at: createdDate,
    });
  }

  console.log(`✅ Generated ${messages.length} messages`);

  if (isDryRun) {
    console.log("\n📋 Sample of generated messages (first 10):");
    messages.slice(0, 10).forEach((msg, i) => {
      console.log(
        `${(i + 1).toString().padEnd(3)} ${msg.full_name.padEnd(25)} | ${msg.email.padEnd(30)} | ${msg.subject.padEnd(20)} | ${msg.status}`,
      );
    });

    const statusCount = {};
    messages.forEach((msg) => {
      statusCount[msg.status] = (statusCount[msg.status] || 0) + 1;
    });
    console.log("\n📊 Expected distribution:");
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(
        `   ${status.padEnd(10)}: ${count} (${Math.round((count / messages.length) * 100)}%)`,
      );
    });

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
      console.log("🧹 Clearing existing messages...");
      const { rowCount } = await client.query("DELETE FROM contact_messages");
      console.log(`   Removed ${rowCount} existing messages`);
    }

    let inserted = 0;
    let failed = 0;

    for (const msg of messages) {
      const query = `
        INSERT INTO contact_messages (
          full_name, email, phone, subject, message, status,
          admin_notes, replied_at, replied_by, reference_number,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;

      const values = [
        msg.full_name,
        msg.email,
        msg.phone,
        msg.subject,
        msg.message,
        msg.status,
        msg.admin_notes,
        msg.replied_at,
        msg.replied_by,
        msg.reference_number,
        msg.created_at,
        msg.updated_at,
      ];

      try {
        await client.query(query, values);
        inserted++;
        if (inserted % 20 === 0) {
          console.log(`📝 Inserted ${inserted}/${messages.length} messages...`);
        }
      } catch (err) {
        failed++;
        console.error(`❌ Failed to insert message: ${msg.email}`, err.message);
        throw err;
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ Successfully seeded ${inserted} contact messages!`);
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} messages`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM contact_messages 
      GROUP BY status 
      ORDER BY count DESC
    `);

    if (stats.length > 0) {
      console.log("\n📊 Summary by status:");
      stats.forEach((stat) => {
        const percentage = Math.round((stat.count / inserted) * 100);
        console.log(
          `   ${stat.status.padEnd(10)}: ${stat.count} (${percentage}%)`,
        );
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error seeding messages:", error);
  } finally {
    client.release();
    await db.end();
  }
}

seedContactMessages().catch(console.error);
