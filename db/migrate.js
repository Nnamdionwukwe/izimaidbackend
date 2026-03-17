#!/usr/bin/env node

// scripts/cleanup-avatars.js
// Usage: node scripts/cleanup-avatars.js [--dry-run]
// Removes orphaned avatar files (files not referenced in database)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../src/config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function cleanupAvatars() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("🧹 Cleaning up avatar files...\n");

  if (dryRun) {
    console.log("📋 DRY RUN MODE - No files will be deleted\n");
  }

  try {
    // Get all avatar files
    const uploadsDir = path.join(process.cwd(), "uploads", "avatars");

    if (!fs.existsSync(uploadsDir)) {
      console.log("ℹ️  No uploads directory found");
      process.exit(0);
    }

    const files = fs.readdirSync(uploadsDir);
    console.log(`📁 Found ${files.length} avatar file(s)\n`);

    if (files.length === 0) {
      console.log("✅ No avatars to clean up");
      process.exit(0);
    }

    // Get all avatar URLs from database
    const result = await pool.query(`
      SELECT id, avatar FROM users WHERE avatar IS NOT NULL
    `);

    const referencedAvatars = new Set(
      result.rows.map((row) => row.avatar.split("/").pop()),
    );

    console.log(`📊 Database has ${result.rows.length} avatar reference(s)\n`);

    // Find orphaned files
    const orphaned = files.filter((file) => !referencedAvatars.has(file));

    if (orphaned.length === 0) {
      console.log("✅ No orphaned avatars found");
      process.exit(0);
    }

    console.log(`🗑️  Found ${orphaned.length} orphaned file(s):\n`);

    let deletedCount = 0;

    for (const file of orphaned) {
      const filepath = path.join(uploadsDir, file);
      const stats = fs.statSync(filepath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`   - ${file} (${sizeMB}MB)`);

      if (!dryRun) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    }

    if (dryRun) {
      console.log(`\n📋 Would delete ${orphaned.length} file(s)`);
      console.log("Run without --dry-run to actually delete files");
    } else {
      console.log(`\n✅ Deleted ${deletedCount} orphaned file(s)`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

cleanupAvatars();
