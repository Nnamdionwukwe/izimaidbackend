// db/migrate_ng_banks.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ng_banks (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text NOT NULL,
        code        text NOT NULL UNIQUE,
        type        text NOT NULL DEFAULT 'bank',  -- 'bank','fintech','mfb'
        is_active   boolean NOT NULL DEFAULT true,
        supports_paystack boolean NOT NULL DEFAULT true
      )
    `);

    // Seed all major Nigerian banks + fintechs
    await client.query(`
      INSERT INTO ng_banks (name, code, type) VALUES
        -- Traditional Banks
        ('Access Bank',                    '044', 'bank'),
        ('Citibank Nigeria',               '023', 'bank'),
        ('Ecobank Nigeria',                '050', 'bank'),
        ('Fidelity Bank',                  '070', 'bank'),
        ('First Bank of Nigeria',          '011', 'bank'),
        ('First City Monument Bank',       '214', 'bank'),
        ('Guaranty Trust Bank',            '058', 'bank'),
        ('Heritage Bank',                  '030', 'bank'),
        ('Keystone Bank',                  '082', 'bank'),
        ('Polaris Bank',                   '076', 'bank'),
        ('Stanbic IBTC Bank',              '221', 'bank'),
        ('Standard Chartered Bank',        '068', 'bank'),
        ('Sterling Bank',                  '232', 'bank'),
        ('Union Bank of Nigeria',          '032', 'bank'),
        ('United Bank for Africa',         '033', 'bank'),
        ('Unity Bank',                     '215', 'bank'),
        ('Wema Bank',                      '035', 'bank'),
        ('Zenith Bank',                    '057', 'bank'),
        ('Jaiz Bank',                      '301', 'bank'),
        ('Taj Bank',                       '302', 'bank'),
        ('Titan Trust Bank',               '102', 'bank'),
        ('Globus Bank',                    '103', 'bank'),
        ('Lotus Bank',                     '303', 'bank'),
        ('Premium Trust Bank',             '105', 'bank'),
        -- Fintechs (CBN licensed)
        ('OPay',                           '100004', 'fintech'),
        ('Moniepoint MFB',                 '50515',  'fintech'),
        ('Kuda Bank',                      '50211',  'fintech'),
        ('PalmPay',                        '100033', 'fintech'),
        ('Carbon (One Finance)',           '565',    'fintech'),
        ('Fairmoney MFB',                  '51318',  'fintech'),
        ('VFD MFB',                        '566',    'fintech'),
        ('ALAT by Wema',                   '035A',   'fintech'),
        ('Sparkle MFB',                    '51310',  'fintech'),
        ('Rubies MFB',                     '125',    'fintech'),
        ('Mint MFB (Mintyn)',               '50304',  'fintech'),
        ('Brass MFB',                      '50615',  'fintech'),
        ('Accion MFB',                     '602',    'mfb'),
        ('Lapo MFB',                       '90325',  'mfb'),
        ('AB MFB',                         '070010', 'mfb')
      ON CONFLICT (code) DO NOTHING
    `);

    console.log("✓ ng_banks: seeded with all major banks + fintechs");
    await client.query("COMMIT");
    console.log("✅ Nigerian banks migration complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
