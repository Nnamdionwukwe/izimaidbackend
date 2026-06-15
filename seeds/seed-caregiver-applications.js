// seeds/seed-caregiver-applications.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const COURSES = [
  "Foundation in Caregiving",
  "Senior Care Specialist",
  "Pediatric Care",
  "Mental Health Support",
];

const CITIES = [
  "Lagos",
  "Abuja",
  "Port Harcourt",
  "Ibadan",
  "Kano",
  "Enugu",
  "Abeokuta",
  "Benin City",
];

const EXPERIENCE_LEVELS = [
  "none",
  "family",
  "volunteer",
  "professional",
  "experienced",
];
const STATUSES = ["pending", "reviewed", "accepted", "rejected", "enrolled"];
const SCHEDULE_OPTIONS = [
  "Weekdays (Mon-Thu 9AM-1PM)",
  "Weekdays (Mon-Thu 6PM-10PM)",
  "Weekends (Sat-Sun 10AM-4PM)",
  "Flexible (Self-paced + Labs)",
];

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

const MOTIVATIONS = [
  "I have always wanted to help others and caregiving feels like my calling.",
  "Looking to start a professional career in healthcare with proper certification.",
  "I've been caring for elderly relatives and want to formalize my skills.",
  "Want to work in pediatric care and make a difference in children's lives.",
  "Interested in mental health support and helping people through difficult times.",
  "Looking for stable employment with growth opportunities.",
  "I want to combine my compassion with professional training.",
  "The job guarantee program is very appealing to my career goals.",
  "I want to eventually open my own caregiving agency.",
  "Healthcare is a growing field and I want to be part of it.",
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

async function checkTableExists() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'caregiver_applications'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedCaregiverApplications() {
  console.log("🌱 Seeding caregiver applications...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: caregiver_applications table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-caregiver-migration.js\n");
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
    const course = getRandomItem(COURSES);
    const experience = getRandomItem(EXPERIENCE_LEVELS);
    const motivation = getRandomItem(MOTIVATIONS);
    const schedule = getRandomItem(SCHEDULE_OPTIONS);

    let finalStatus;
    const randomWeight = Math.random();
    if (randomWeight < 0.4) finalStatus = "pending";
    else if (randomWeight < 0.55) finalStatus = "reviewed";
    else if (randomWeight < 0.7) finalStatus = "accepted";
    else if (randomWeight < 0.85) finalStatus = "enrolled";
    else finalStatus = "rejected";

    const applicationDate = getRandomDate(startDate, endDate);
    const referenceNumber = `CGC-${applicationDate.getTime().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    let adminNotes = null;
    if (finalStatus !== "pending") {
      const noteOptions = [
        "Strong candidate with relevant experience.",
        "Good motivation, schedule interview.",
        "Needs more experience before advanced course.",
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
      preferred_course: course,
      experience_level: experience,
      motivation,
      schedule_preference: schedule,
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
      console.log(
        `${(i + 1).toString().padEnd(3)} ${app.full_name.padEnd(25)} | ${app.email.padEnd(30)} | ${app.preferred_course.substring(0, 25).padEnd(25)} | ${app.status.padEnd(10)}`,
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
        "DELETE FROM caregiver_applications",
      );
      console.log(`   Removed ${rowCount} existing applications`);
    }

    let inserted = 0;
    let failed = 0;

    for (const app of applications) {
      const query = `
        INSERT INTO caregiver_applications (
          full_name, email, phone, city, preferred_course,
          experience_level, motivation, schedule_preference, status,
          admin_notes, reference_number, application_date,
          reviewed_at, reviewed_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `;

      const values = [
        app.full_name,
        app.email,
        app.phone,
        app.city,
        app.preferred_course,
        app.experience_level,
        app.motivation,
        app.schedule_preference,
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
    console.log(`\n✅ Successfully seeded ${inserted} caregiver applications!`);
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} applications`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM caregiver_applications 
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

seedCaregiverApplications().catch(console.error);
