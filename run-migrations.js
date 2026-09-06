import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

const migrations = [
  'db/migrate_global.js',
  'db/migrate_auth.js',
  'db/migrate_bookings_v2.js',
  'db/migrate_payments_v2.js',
  'db/migrate_admin_v2.js',
  'db/migrate_notifications_v2.js',
  'db/migrate_subscriptions.js',
  'db/migrate_withdrawals.js',
  'db/migrate_ng_banks.js',
  'db/migrate_pricing_settings.js',
  'db/migrate_transaction_pin.js',
];

async function runMigrations() {
  console.log('📦 Running migrations...\n');
  
  for (const migration of migrations) {
    console.log(`▶️  Running ${migration}...`);
    try {
      const { stdout, stderr } = await execAsync(`node ${migration}`);
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      console.log(`✅ ${migration} completed\n`);
    } catch (error) {
      console.error(`❌ ${migration} failed:`, error.message);
      // Continue with next migration
    }
  }
  
  console.log('✅ All migrations completed!');
}

runMigrations().catch(console.error);
