#!/usr/bin/env node

// scripts/test-avatar-upload.js
// Usage: node scripts/test-avatar-upload.js <token> <image-path>
// Example: node scripts/test-avatar-upload.js "your_bearer_token" "./test-image.jpg"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.API_URL || "http://localhost:8080";

async function testAvatarUpload() {
  const [, , token, imagePath] = process.argv;

  if (!token || !imagePath) {
    console.log(
      "❌ Usage: node scripts/test-avatar-upload.js <token> <image-path>",
    );
    console.log(
      "   Example: node scripts/test-avatar-upload.js 'eyJhbGc...' './photo.jpg'",
    );
    process.exit(1);
  }

  try {
    console.log("🧪 Testing avatar upload...\n");
    console.log(`📍 API URL: ${API_URL}`);
    console.log(`📸 Image: ${imagePath}`);
    console.log(`🔑 Token: ${token.substring(0, 20)}...\n`);

    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      console.error(`❌ File not found: ${imagePath}`);
      process.exit(1);
    }

    // Check file size
    const stats = fs.statSync(imagePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    if (stats.size > 5 * 1024 * 1024) {
      console.error(`❌ File too large: ${fileSizeMB}MB (max 5MB)`);
      process.exit(1);
    }

    console.log(`✅ File size: ${fileSizeMB}MB`);

    // Read file
    const fileBuffer = fs.readFileSync(imagePath);
    const fileName = path.basename(imagePath);

    // Create FormData
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("avatar", fileBuffer, fileName);

    console.log(`📤 Uploading to ${API_URL}/api/maids/avatar\n`);

    // Upload
    const response = await fetch(`${API_URL}/api/maids/avatar`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    const data = await response.json();

    if (response.ok) {
      console.log("✅ Upload successful!\n");
      console.log("📋 Response:");
      console.log(JSON.stringify(data, null, 2));
      console.log(`\n📸 Avatar URL: ${data.avatar_url}`);
      console.log(`🔗 Access at: ${API_URL}${data.avatar_url}`);
    } else {
      console.error("❌ Upload failed!\n");
      console.error("📋 Error Response:");
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

testAvatarUpload();
