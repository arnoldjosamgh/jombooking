require('dotenv').config();
const { Pool } = require('pg');
const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DB_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('Starting Migration 8: Add max_clients_per_slot');

    await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS max_clients_per_slot INTEGER DEFAULT 1;`);
    console.log('✅ businesses.max_clients_per_slot added');

    console.log('\n✅ Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}
run();
