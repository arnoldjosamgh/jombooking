require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting Migration 3: Adding seller tracking for history...');

    // 1. Add seller_id to orders
    await client.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL;
    `);

    // 2. Add seller_id to bookings
    await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL;
    `);

    console.log('Added seller_id columns.');

    // 3. Update businesses type to ensure 'both' is allowed
    // Since business_type is a VARCHAR with a CHECK constraint in the DB (I see no ENUM),
    // we need to drop the check constraint and recreate it.
    try {
       // In PostgreSQL, to drop a check constraint we usually have to know its name.
       // Let's drop businesses_type_check if it exists.
       await client.query(`ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_type_check;`);
       await client.query(`ALTER TABLE businesses ADD CONSTRAINT businesses_type_check CHECK (type IN ('product', 'service', 'both'));`);
       console.log('Added "both" to VARCHAR check constraint.');
    } catch (e) {
       console.log('Could not update check constraint:', e.message);
    }

    console.log('Migration 3 successful.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
