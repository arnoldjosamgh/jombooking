require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting Migration 4: Lunch hours and UGX currency...');

    // 1. Change default currency symbol constraint if any, or just update existing
    // We update all existing businesses to UGX
    await client.query(`UPDATE businesses SET currency_symbol = 'UGX' WHERE currency_symbol = '$' OR currency_symbol IS NULL`);
    
    // Attempt to alter default on the column
    try {
      await client.query(`ALTER TABLE businesses ALTER COLUMN currency_symbol SET DEFAULT 'UGX'`);
    } catch(e) {
      console.log('Could not alter default currency:', e.message);
    }

    // 2. Add lunch_start and lunch_end columns
    await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS lunch_start TIME`);
    await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS lunch_end TIME`);

    console.log('Migration 4 successful.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
