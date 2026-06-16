// seeds/seed-maid-applications.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const CITIES = ["Abuja", "Lagos"];
const EXPERIENCE_LEVELS = ["0", "1", "2", "3", "5+"];
const STATUSES = ["pending", "reviewed", "approved", "rejected", "onboarded"];

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

const SERVICES = [
  "General home cleaning",
  "Deep cleaning",
  "Kitchen cleaning",
  "Bathroom cleaning",
  "Laundry & ironing",
  "Home organisation",
  "Window cleaning",
  "Carpet cleaning",
];

const MESSAGES = [
  "I have been cleaning homes for over 5 years and I'm very passionate about it. I'm reliable, punctual, and pay attention to detail. I would love to join the platform.",
  "I'm looking for flexible work that allows me to balance family responsibilities. I have experience in both residential and commercial cleaning.",
  "I'm a professional cleaner with 3 years of experience. I specialize in deep cleaning and organization. I have my own supplies and transportation.",
  "I need a job that fits around my school schedule. I'm available on weekends and evenings. I'm very thorough and clients always appreciate my work.",
  "I have been working as a maid for 2 years and I'm looking to join a platform that offers more job opportunities and better pay.",
  "I'm passionate about cleaning and making homes look beautiful. I'm available full-time and can start immediately.",
  "I have experience cleaning luxury apartments and offices. I'm very detail-oriented and take pride in my work.",
  "I'm a mother of two and I'm looking for flexible work. I have 4 years of cleaning experience and excellent references.",
  "I specialize in deep cleaning and organization. I'm very efficient and always complete jobs on time.",
  "I'm looking for a stable income and the opportunity to work with a reputable company. I have 6 years of experience in cleaning.",
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

function getRandomServices() {
  const numServices = Math.floor(Math.random() * 4) + 1;
  const shuffled = [...SERVICES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, numServices);
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
        WHERE table_name = 'maid_applications'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedMaidApplications() {
  console.log("🌱 Seeding maid applications...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: maid_applications table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-maid-application-migration.js\n");
    process.exit(1);
  }

  const isDryRun = process.argv.includes("--dry-run");
  const shouldClear = process.argv.includes("--clear");
  const numApplications =
    parseInt(
      process.argv.find((arg) => arg.includes("--count="))?.split("=")[1],
    ) || 50;

  console.log(`Mode: ${isDryRun ? "DRY RUN" : "COMMIT"}`);
  console.log(`Clear existing: ${shouldClear ? "YES" : "NO"}`);
  console.log(`Number of applications: ${numApplications}`);

  const applications = [];

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  console.log(`\n📝 Generating ${numApplications} applications...`);

  for (let i = 0; i < numApplications; i++) {
    const firstName = getRandomItem(FIRST_NAMES);
    const lastName = getRandomItem(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`;
    const phone = getRandomPhone();
    const city = getRandomItem(CITIES);
    const experience = getRandomItem(EXPERIENCE_LEVELS);
    const services = getRandomServices();
    const message = getRandomItem(MESSAGES);

    let status;
    const randomWeight = Math.random();
    if (randomWeight < 0.35) status = "pending";
    else if (randomWeight < 0.55) status = "reviewed";
    else if (randomWeight < 0.75) status = "approved";
    else if (randomWeight < 0.9) status = "onboarded";
    else status = "rejected";

    const createdDate = getRandomDate(startDate, endDate);
    const referenceNumber = `MA-${createdDate.getTime().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    let adminNotes = null;
    let reviewedAt = null;
    let reviewedBy = null;

    if (status !== "pending") {
      const noteOptions = [
        "Strong candidate with relevant experience.",
        "Good communication skills, approved for onboarding.",
        "Needs more experience before approval.",
        "Excellent references, moving to onboarding.",
        "Follow up for document verification.",
        "Approved for next training cohort.",
        "Rejected - insufficient experience.",
        "Consider for part-time positions.",
      ];
      adminNotes = getRandomItem(noteOptions);
      reviewedAt = new Date(
        createdDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000,
      );
      reviewedBy = "admin";
    }

    applications.push({
      full_name: fullName,
      email,
      phone,
      city,
      experience_level: experience,
      services,
      message,
      status,
      admin_notes: adminNotes,
      reviewed_at: reviewedAt,
      reviewed_by: reviewedBy,
      reference_number: referenceNumber,
      created_at: createdDate,
      updated_at: createdDate,
    });
  }

  console.log(`✅ Generated ${applications.length} applications`);

  if (isDryRun) {
    console.log("\n📋 Sample of generated applications (first 10):");
    applications.slice(0, 10).forEach((app, i) => {
      console.log(
        `${(i + 1).toString().padEnd(3)} ${app.full_name.padEnd(25)} | ${app.email.padEnd(30)} | ${app.city.padEnd(10)} | ${app.status}`,
      );
    });

    const statusCount = {};
    applications.forEach((app) => {
      statusCount[app.status] = (statusCount[app.status] || 0) + 1;
    });
    console.log("\n📊 Expected distribution:");
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(
        `   ${status.padEnd(10)}: ${count} (${Math.round((count / applications.length) * 100)}%)`,
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
      console.log("🧹 Clearing existing applications...");
      const { rowCount } = await client.query("DELETE FROM maid_applications");
      console.log(`   Removed ${rowCount} existing applications`);
    }

    let inserted = 0;
    let failed = 0;

    for (const app of applications) {
      const query = `
        INSERT INTO maid_applications (
          full_name, email, phone, city, experience_level,
          services, message, status, admin_notes,
          reviewed_at, reviewed_by, reference_number,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `;

      const values = [
        app.full_name,
        app.email,
        app.phone,
        app.city,
        app.experience_level,
        app.services,
        app.message,
        app.status,
        app.admin_notes,
        app.reviewed_at,
        app.reviewed_by,
        app.reference_number,
        app.created_at,
        app.updated_at,
      ];

      try {
        await client.query(query, values);
        inserted++;
        if (inserted % 20 === 0) {
          console.log(
            `📝 Inserted ${inserted}/${applications.length} applications...`,
          );
        }
      } catch (err) {
        failed++;
        console.error(
          `❌ Failed to insert application: ${app.email}`,
          err.message,
        );
        throw err;
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ Successfully seeded ${inserted} maid applications!`);
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} applications`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM maid_applications 
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
    console.error("❌ Error seeding applications:", error);
  } finally {
    client.release();
    await db.end();
  }
}

seedMaidApplications().catch(console.error);
