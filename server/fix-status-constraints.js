/**
 * Fix status CHECK constraints on orders and bookings tables
 * to include 'ready' as a valid status.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    console.log('Fixing status CHECK constraints...');

    // Drop and recreate orders status constraint
    await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
    await client.query(`ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending','ready','completed','cancelled'))`);
    console.log('✅ orders.status constraint fixed (added ready)');

    // Drop and recreate bookings status constraint
    await client.query(`ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check`);
    await client.query(`ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('confirmed','ready','completed','cancelled'))`);
    console.log('✅ bookings.status constraint fixed (added ready)');

    console.log('\n✅ All constraints fixed!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
