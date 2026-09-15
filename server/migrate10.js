require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Starting migration 10: adding low_stock_threshold to businesses...');
    
    await client.query(`
      ALTER TABLE businesses 
      ADD COLUMN IF NOT EXISTS low_stock_threshold INT DEFAULT 10
    `);

    console.log('Migration 10 complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();
