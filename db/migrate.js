// src/migrations/add_avatar_column.js

export const checkAndAddAvatarColumn = async (db) => {
  try {
    console.log("[Migration] Checking if avatar column exists...");

    // Check if column exists
    const { rows } = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'avatar'
    `);

    if (rows.length > 0) {
      console.log("✅ Avatar column already exists");
      return;
    }

    // Add avatar column if it doesn't exist
    console.log("[Migration] Adding avatar column to users table...");
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN avatar VARCHAR(500) DEFAULT NULL
    `);

    console.log("✅ Avatar column added successfully");
  } catch (err) {
    console.error("[Migration Error]", err);
  }
};

// Call this in your server startup:
// import { checkAndAddAvatarColumn } from "./migrations/add_avatar_column.js";
// await checkAndAddAvatarColumn(db);
