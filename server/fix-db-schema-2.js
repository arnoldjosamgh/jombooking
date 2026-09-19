const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  console.log('done');
  process.exit(0);
}
run();
