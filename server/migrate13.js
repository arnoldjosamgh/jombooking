const db = require('./db');

async function migrate() {
  console.log('--- Running Migration 13 (Multi-service bookings) ---');
  try {
    await db.query('BEGIN');

    // Store multiple service IDs as JSONB array
    await db.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS service_ids JSONB
    `);

    // Pre-computed total duration in minutes
    await db.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS total_duration INT DEFAULT 0
    `);

    // Pre-computed total price
    await db.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS total_price NUMERIC(10,2) DEFAULT 0
    `);

    await db.query('COMMIT');
    console.log('Migration 13 successful.');
    process.exit(0);
  } catch (err) {
    if (err.code === '42701') {
      console.log('Migration 13 skipped: columns already exist.');
      process.exit(0);
    }
    await db.query('ROLLBACK');
    console.error('Migration 13 failed:', err);
    process.exit(1);
  }
}

migrate();
