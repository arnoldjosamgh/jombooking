const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id           SERIAL PRIMARY KEY,
      business_id  INT REFERENCES businesses(id) ON DELETE CASCADE,
      service_id   INT REFERENCES services(id) ON DELETE CASCADE,
      slot_time    TIMESTAMP NOT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, service_id, slot_time)
    );
  `);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id INT REFERENCES services(id) ON DELETE SET NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_service ON bookings(service_id);`);
  console.log('done');
  process.exit(0);
}
run();
