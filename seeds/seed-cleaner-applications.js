// seeds/seed-cleaner-applications.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const TRACKS = [
  "Home Cleaning Professional",
  "Commercial & Office Cleaning",
  "Deep Cleaning Specialist",
  "Post-Construction Cleaning",
  "Kitchen & Hospitality Cleaning",
  "Childcare & Elderly Home Cleaning",
  "Not sure — recommend one for me",
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
  "Okafor",
  "Adebayo",
  "Oluwole",
  "Akinwale",
  "Ogunyemi",
  "Oladapo",
];

const MOTIVATIONS = [
  "I want to start a professional cleaning business and need proper certification.",
  "Looking to upgrade my skills and earn more as a professional cleaner.",
  "I've been cleaning for years but want official certification to get better jobs.",
  "Interested in specializing in eco-friendly and non-toxic cleaning methods.",
  "Want to work with Deusizi Sparkle platform as a certified cleaner.",
  "Looking for stable employment in the hospitality cleaning sector.",
  "I enjoy cleaning and want to turn my passion into a professional career.",
  "Need formal training to understand proper cleaning chemistry and safety.",
  "Want to provide the best service possible to my existing clients.",
  "Looking to transition from informal cleaning to professional standards.",
  "My family relies on my income and I want to increase my earning potential.",
  "I've seen friends succeed through Deusizi Academy and want the same opportunity.",
  "Cleaning is therapeutic for me and I want to make it my career.",
  "I want to eventually employ other cleaners and run my own agency.",
  "The job placement guarantee is very appealing to me.",
];

// Simple flat arrays for availability options
const AVAILABILITY_SINGLE = [
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
  return getRandomItem(AVAILABILITY_SINGLE);
}

async function checkTableExists() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'cleaner_applications'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedCleanerApplications() {
  console.log("🌱 Seeding cleaner applications...");

  // Check if table exists first
  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error("❌ Error: cleaner_applications table does not exist!");
    console.log("\n📝 Please run the migration first:");
    console.log("   node migrations/run-cleaner-migration.js\n");
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

  // Generate applications over the last 6 months
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

    // Weighted status distribution (more realistic)
    let finalStatus;
    const randomWeight = Math.random();
    if (randomWeight < 0.4) finalStatus = "pending";
    else if (randomWeight < 0.55) finalStatus = "reviewed";
    else if (randomWeight < 0.7) finalStatus = "accepted";
    else if (randomWeight < 0.85) finalStatus = "enrolled";
    else finalStatus = "rejected";

    const applicationDate = getRandomDate(startDate, endDate);
    const referenceNumber = `DSA-${applicationDate.getTime().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    // Admin notes for reviewed applications
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
        "Has existing certification, fast-track recommended.",
        "Language barrier - recommend basic course first.",
      ];
      adminNotes = getRandomItem(noteOptions);
    }

    let reviewedAt = null;
    let reviewedBy = null;
    if (finalStatus !== "pending") {
      reviewedAt = new Date(
        applicationDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000,
      );
      reviewedBy = 1; // Admin user ID
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

    // Show distribution
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

    // Clear existing data if requested
    if (shouldClear) {
      console.log("🧹 Clearing existing applications...");
      const { rowCount } = await client.query(
        "DELETE FROM cleaner_applications",
      );
      console.log(`   Removed ${rowCount} existing applications`);
    }

    let inserted = 0;
    let failed = 0;

    for (const app of applications) {
      const query = `
        INSERT INTO cleaner_applications (
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
        app.availability, // This is now a simple array, not nested
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
        // Rollback the transaction if we hit an error
        throw err;
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ Successfully seeded ${inserted} cleaner applications!`);
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} applications`);
    }

    // Show summary
    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM cleaner_applications 
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

    // Show recent applications
    const { rows: recent } = await client.query(`
      SELECT full_name, preferred_track, status, application_date, availability
      FROM cleaner_applications 
      ORDER BY application_date DESC 
      LIMIT 5
    `);

    if (recent.length > 0) {
      console.log("\n📋 Most recent applications:");
      recent.forEach((app) => {
        const availStr = app.availability
          ? app.availability.join(", ")
          : "None";
        console.log(
          `   - ${app.full_name} | ${app.preferred_track.substring(0, 30)} | ${app.status} | ${app.application_date.toISOString().split("T")[0]} | [${availStr}]`,
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

// Run the seed function
seedCleanerApplications().catch(console.error);
