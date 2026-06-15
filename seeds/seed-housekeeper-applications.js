// seeds/seed-housekeeper-applications.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const TRACKS = [
  "Household Management",
  "Laundry & Linen Care",
  "Home Organisation",
  "Meal Prep & Kitchen Support",
  "Luxury & Estate Housekeeping",
  "Childcare-Safe Housekeeping",
  "Not sure - recommend one for me",
];

const CITIES = ["Abuja", "Lagos"];
const EXPERIENCE_LEVELS = ["none", "under1", "1-2", "3-5", "5+"];
const STATUSES = ["pending", "reviewed", "accepted", "rejected", "enrolled"];

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
  "Lawal",
];

const MOTIVATIONS = [
  "I want to start a professional housekeeping career and need proper certification.",
  "Looking to upgrade my skills and earn more as a professional housekeeper.",
  "I've been cleaning homes for years but want official certification for better opportunities.",
  "Interested in specializing in luxury estate management and high-end households.",
  "Want to work with Deusizi Sparkle platform as a certified housekeeper.",
  "Looking for stable employment with premium households.",
  "I enjoy organizing homes and want to turn my passion into a professional career.",
  "Need formal training to understand proper cleaning protocols and safety.",
  "Want to provide the best service possible to my existing clients.",
  "Looking to transition from informal housekeeping to professional standards.",
  "I want to eventually train other housekeepers and run my own agency.",
  "The job placement guarantee is very appealing to me.",
];

const AVAILABILITY_OPTIONS = [
  ["Weekday mornings"],
  ["Weekday afternoons"],
  ["Weekday evenings"],
  ["Saturday"],
  ["Sunday"],
  ["Weekday mornings", "Weekday afternoons"],
  ["Weekday mornings", "Weekday evenings"],
  ["Weekday afternoons", "Weekday evenings"],
  ["Weekday mornings", "Saturday"],
  ["Weekday afternoons", "Saturday"],
  ["Saturday", "Sunday"],
  ["Weekday mornings", "Weekday afternoons", "Weekday evenings"],
  ["Weekday mornings", "Saturday", "Sunday"],
  ["Weekday afternoons", "Saturday", "Sunday"],
  ["Weekday mornings", "Weekday afternoons", "Saturday", "Sunday"],
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

function getRandomAvailability() {
  return getRandomItem(AVAILABILITY_OPTIONS);
}

async function checkTableExists() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'housekeeper_applications'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedHousekeeperApplications() {
  console.log("🌱 Seeding housekeeper applications...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: housekeeper_applications table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-housekeeper-migration.js\n");
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
  startDate.setMonth(startDate.getMonth() - 6);

  console.log(`\n📝 Generating ${numApplications} applications...`);

  for (let i = 0; i < numApplications; i++) {
    const firstName = getRandomItem(FIRST_NAMES);
    const lastName = getRandomItem(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}@example.com`;
    const phone = `080${Math.floor(Math.random() * 10000000)
      .toString()
      .padStart(7, "0")}`;
    const city = getRandomItem(CITIES);
    const track = getRandomItem(TRACKS);
    const experience = getRandomItem(EXPERIENCE_LEVELS);
    const motivation = getRandomItem(MOTIVATIONS);
    const availability = getRandomAvailability();

    let finalStatus;
    const randomWeight = Math.random();
    if (randomWeight < 0.4) finalStatus = "pending";
    else if (randomWeight < 0.55) finalStatus = "reviewed";
    else if (randomWeight < 0.7) finalStatus = "accepted";
    else if (randomWeight < 0.85) finalStatus = "enrolled";
    else finalStatus = "rejected";

    const applicationDate = getRandomDate(startDate, endDate);
    const referenceNumber = `DHA-${applicationDate.getTime().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    let adminNotes = null;
    if (finalStatus !== "pending") {
      const noteOptions = [
        "Strong candidate with relevant experience.",
        "Good motivation, schedule interview.",
        "Needs more experience before advanced track.",
        "Excellent communication skills.",
        "Follow up for availability confirmation.",
        "Pending document verification.",
        "Approved for next cohort.",
        "Consider for scholarship program.",
      ];
      adminNotes = getRandomItem(noteOptions);
    }

    let reviewedAt = null;
    let reviewedBy = null;
    if (finalStatus !== "pending") {
      reviewedAt = new Date(
        applicationDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000,
      );
      reviewedBy = 1;
    }

    applications.push({
      full_name: fullName,
      email,
      phone,
      city,
      preferred_track: track,
      experience_level: experience,
      motivation,
      availability,
      status: finalStatus,
      admin_notes: adminNotes,
      reference_number: referenceNumber,
      application_date: applicationDate,
      reviewed_at: reviewedAt,
      reviewed_by: reviewedBy,
      created_at: applicationDate,
      updated_at: applicationDate,
    });
  }

  console.log(`✅ Generated ${applications.length} applications`);

  if (isDryRun) {
    console.log("\n📋 Sample of generated applications (first 10):");
    applications.slice(0, 10).forEach((app, i) => {
      const availStr = app.availability.join(", ");
      console.log(
        `${(i + 1).toString().padEnd(3)} ${app.full_name.padEnd(25)} | ${app.email.padEnd(30)} | ${app.preferred_track.substring(0, 25).padEnd(25)} | ${app.status.padEnd(10)} | [${availStr}]`,
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
      const { rowCount } = await client.query(
        "DELETE FROM housekeeper_applications",
      );
      console.log(`   Removed ${rowCount} existing applications`);
    }

    let inserted = 0;
    let failed = 0;

    for (const app of applications) {
      const query = `
        INSERT INTO housekeeper_applications (
          full_name, email, phone, city, preferred_track,
          experience_level, motivation, availability, status,
          admin_notes, reference_number, application_date,
          reviewed_at, reviewed_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `;

      const values = [
        app.full_name,
        app.email,
        app.phone,
        app.city,
        app.preferred_track,
        app.experience_level,
        app.motivation,
        app.availability,
        app.status,
        app.admin_notes,
        app.reference_number,
        app.application_date,
        app.reviewed_at,
        app.reviewed_by,
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
    console.log(
      `\n✅ Successfully seeded ${inserted} housekeeper applications!`,
    );
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} applications`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM housekeeper_applications 
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

seedHousekeeperApplications().catch(console.error);
