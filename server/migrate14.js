/**
 * Migration 14 — Add mtn_momo_number and airtel_money_number to businesses
 * Also adds momo_code column alias for backward compat.
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE businesses
        ADD COLUMN IF NOT EXISTS mtn_momo_number  VARCHAR(20) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS airtel_momo_number VARCHAR(20) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS momo_code         VARCHAR(50) DEFAULT NULL
    `);

    await client.query('COMMIT');
    console.log('✅ Migration 14 complete: mtn_momo_number, airtel_momo_number, momo_code added to businesses');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration 14 failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
