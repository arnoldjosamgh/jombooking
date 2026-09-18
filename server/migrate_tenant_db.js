require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : false,
});

async function run() {
  try {
    console.log('Adding tenant_db_url to businesses table...');
    await pool.query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tenant_db_url TEXT;');
    console.log('Done!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    process.exit(0);
  }
}

run();
