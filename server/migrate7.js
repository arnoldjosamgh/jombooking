require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Migration 7: Adding missing columns to orders table...');

    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_id VARCHAR(50);');
    console.log('✓ order_group_id');

    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50);');
    console.log('✓ receipt_number');

    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;');
    console.log('✓ notes');

    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2);');
    console.log('✓ total_price');

    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL;');
    console.log('✓ seller_id');

    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);');
    console.log('✓ products.barcode');

    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;');
    console.log('✓ products.is_deleted');

    console.log('\n✅ Migration 7 complete!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();
