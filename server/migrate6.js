require('dotenv').config();
const { Pool } = require('pg');
const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DB_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('Starting Migration 6: Soft delete for products and services');

    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;`);
    console.log('✓ products.is_deleted added');

    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;`);
    console.log('✓ services.is_deleted added');

    console.log('\n✅ Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}
run();
