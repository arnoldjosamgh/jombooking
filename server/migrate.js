require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
});

async function run() {
  try {
    // 1. Services table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id                SERIAL PRIMARY KEY,
        business_id       INT REFERENCES businesses(id) ON DELETE CASCADE,
        name              VARCHAR(100) NOT NULL,
        price             DECIMAL(10,2) NOT NULL DEFAULT 0,
        duration_minutes  INT NOT NULL DEFAULT 30,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created services table');

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);`);

    // 2. Blocked slots table
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
    console.log('Created blocked_slots table');

    // 3. Add service_id to bookings
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id INT REFERENCES services(id) ON DELETE SET NULL;`);
    console.log('Added service_id to bookings');

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_service ON bookings(service_id);`);
    console.log('Done!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    pool.end();
  }
}
run();
