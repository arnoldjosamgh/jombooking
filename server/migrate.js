require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
});

async function run() {
  try {
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);`);
    console.log('Added barcode column to products');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);`);
    console.log('Created barcode index');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}
run();
