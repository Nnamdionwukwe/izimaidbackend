// seeds/seed-domestic-certification-applications.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const PROGRAMS = [
  "Household Management",
  "Professional Cooking & Culinary",
  "Professional Childcare",
  "Elderly Companion Care",
  "Laundry & Textile Care",
  "Hospitality & Service",
];

const CITIES = [
  "Lagos (Ikoyi, VI, Lekki)",
  "Lagos (Ikeja, GRA)",
  "Lagos (Surulere, Yaba)",
  "Abuja (Maitama, Asokoro)",
  "Abuja (Wuse, Garki)",
  "Port Harcourt (GRA)",
  "Ibadan (Jericho, Bodija)",
  "Kano (Nassarawa GRA)",
  "Enugu (Independence Layout)",
];

const EXPERIENCE_LEVELS = ["none", "less1", "1-2", "3-5", "5+"];
const EDUCATION_LEVELS = [
  "primary",
  "secondary",
  "diploma",
  "degree",
  "postgraduate",
];
const STATUSES = ["pending", "reviewed", "accepted", "rejected", "enrolled"];
const SCHEDULE_OPTIONS = [
  "Full-time (Mon-Thu 9AM-3PM) - 4 weeks",
  "Part-time (Mon-Wed 6PM-9PM) - 8 weeks",
  "Weekend (Sat-Sun 10AM-4PM) - 8 weeks",
  "Flexible (Self-paced with labs) - Up to 12 weeks",
];
const START_MONTHS = [
  "January",
  "March",
  "May",
  "July",
  "September",
  "November",
];
const HEAR_ABOUT_OPTIONS = [
  "social",
  "friend",
  "search",
  "ad",
  "event",
  "other",
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
  "I want to start a professional career in domestic service with proper certification.",
  "Looking to upgrade my skills and earn more as a household professional.",
  "I've been working in homes for years but want official certification for better opportunities.",
  "Interested in specializing in luxury household management.",
  "Want to work with Deusizi platform as a certified professional.",
  "Looking for stable employment with premium households.",
  "I enjoy organizing and managing homes and want to turn my passion into a career.",
  "Need formal training to understand professional standards and protocols.",
  "Want to provide the best service possible to my clients.",
  "Looking to transition from informal domestic work to professional standards.",
  "I want to eventually train other domestic staff and run my own agency.",
  "The job placement guarantee is very appealing to my career goals.",
];

const EMERGENCY_CONTACTS = [
  "Mr. John Doe",
  "Mrs. Jane Smith",
  "Dr. James Wilson",
  "Chief Emeka Okafor",
  "Alhaji Musa Bello",
  "Prof. Adebayo Ogunlesi",
  "Mrs. Grace Adeyemi",
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
        WHERE table_name = 'domestic_certification_applications'
      );
    `);
    return rows[0].exists;
  } finally {
    client.release();
  }
}

async function seedDomesticCertificationApplications() {
  console.log("🌱 Seeding domestic certification applications...");

  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error(
      "❌ Error: domestic_certification_applications table does not exist!",
    );
    console.log("\n📝 Please run the migration first:");
    console.log("   node scripts/run-domestic-certification-migration.js\n");
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
    const phone = getRandomPhone();
    const city = getRandomItem(CITIES);
    const programChoice = getRandomItem(PROGRAMS);
    const experience = getRandomItem(EXPERIENCE_LEVELS);
    const education = getRandomItem(EDUCATION_LEVELS);
    const previousTraining =
      Math.random() > 0.7
        ? "Completed basic housekeeping training previously"
        : null;
    const schedulePreference = getRandomItem(SCHEDULE_OPTIONS);
    const startMonth = getRandomItem(START_MONTHS);
    const motivation = getRandomItem(MOTIVATIONS);
    const referralCode = Math.random() > 0.8 ? "DEUSIZI-DOMESTIC-2026" : null;
    const hearAbout = getRandomItem(HEAR_ABOUT_OPTIONS);
    const emergencyContact = getRandomItem(EMERGENCY_CONTACTS);
    const emergencyPhone = getRandomPhone();

    let finalStatus;
    const randomWeight = Math.random();
    if (randomWeight < 0.4) finalStatus = "pending";
    else if (randomWeight < 0.55) finalStatus = "reviewed";
    else if (randomWeight < 0.7) finalStatus = "accepted";
    else if (randomWeight < 0.85) finalStatus = "enrolled";
    else finalStatus = "rejected";

    const applicationDate = getRandomDate(startDate, endDate);
    const referenceNumber = `DSA-${applicationDate.getTime().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    let adminNotes = null;
    if (finalStatus !== "pending") {
      const noteOptions = [
        "Strong candidate with relevant experience.",
        "Good motivation, schedule interview.",
        "Needs more experience before advanced program.",
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
      program_choice: programChoice,
      experience_level: experience,
      education_level: education,
      previous_training: previousTraining,
      schedule_preference: schedulePreference,
      start_month: startMonth,
      motivation,
      referral_code: referralCode,
      hear_about: hearAbout,
      emergency_contact: emergencyContact,
      emergency_phone: emergencyPhone,
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
        `${(i + 1).toString().padEnd(3)} ${app.full_name.padEnd(25)} | ${app.email.padEnd(30)} | ${app.program_choice.substring(0, 25).padEnd(25)} | ${app.status.padEnd(10)}`,
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
        "DELETE FROM domestic_certification_applications",
      );
      console.log(`   Removed ${rowCount} existing applications`);
    }

    let inserted = 0;
    let failed = 0;

    for (const app of applications) {
      const query = `
        INSERT INTO domestic_certification_applications (
          full_name, email, phone, city, program_choice,
          experience_level, education_level, previous_training,
          schedule_preference, start_month, motivation, referral_code,
          hear_about, emergency_contact, emergency_phone, status,
          admin_notes, reference_number, application_date,
          reviewed_at, reviewed_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      `;

      const values = [
        app.full_name,
        app.email,
        app.phone,
        app.city,
        app.program_choice,
        app.experience_level,
        app.education_level,
        app.previous_training,
        app.schedule_preference,
        app.start_month,
        app.motivation,
        app.referral_code,
        app.hear_about,
        app.emergency_contact,
        app.emergency_phone,
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
      `\n✅ Successfully seeded ${inserted} domestic certification applications!`,
    );
    if (failed > 0) {
      console.log(`⚠️  Failed to insert ${failed} applications`);
    }

    const { rows: stats } = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM domestic_certification_applications 
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

seedDomesticCertificationApplications().catch(console.error);
