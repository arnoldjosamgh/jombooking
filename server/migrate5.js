require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting Migration 5: Business location, receipt_number sequence, read_at for messages...');

    // 1. Add location column to businesses
    await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS location TEXT`);

    // 2. Add phone_number column if not present (may have been added in a previous migration)
    await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30)`);

    // 3. Add read_at to messages for unread tracking
    await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP`);

    // 4. Add receipt_number to orders
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(20)`);
    // Generate receipt numbers for existing orders
    await client.query(`
      UPDATE orders SET receipt_number = 'ORD-' || LPAD(id::text, 5, '0')
      WHERE receipt_number IS NULL
    `);

    // 5. Add receipt_number to bookings
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(20)`);
    await client.query(`
      UPDATE bookings SET receipt_number = 'BKG-' || LPAD(id::text, 5, '0')
      WHERE receipt_number IS NULL
    `);

    console.log('Migration 5 successful.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
