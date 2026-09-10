/**
 * Migration: adds status col to businesses, allows 'both' type, adds seller_id to orders
 */
require('dotenv').config();
const { Pool } = require('pg');
const DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DB_URL });

async function run() {
  const client = await pool.connect();
  try {
    // 1. Add status to businesses (paused / active)
    await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','paused'));`);
    console.log('✓ businesses.status column added');

    // 2. The business_type enum needs 'both' added. Use text column workaround.
    // Drop existing check, convert to text, add new check
    await client.query(`ALTER TABLE businesses ALTER COLUMN type TYPE TEXT;`);
    // drop old enum cast if any – ignore errors
    try { await client.query(`DROP TYPE IF EXISTS business_type;`); } catch(_){}
    await client.query(`ALTER TABLE businesses ADD CONSTRAINT businesses_type_check CHECK (type IN ('product','service','both'));`);
    console.log('✓ businesses.type updated to allow both');

    // 3. Add seller_id to orders so we know which seller processed it
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL;`);
    console.log('✓ orders.seller_id added');

    // 4. Add business_id to sellers (so multiple sellers can share one business)
    await client.query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_id INT REFERENCES businesses(id) ON DELETE SET NULL;`);
    console.log('✓ sellers.business_id added (for multi-seller per company)');

    console.log('\n✅ Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}
run();
