const db = require('./db');

async function migrate() {
  console.log('--- Running Migration 11 (Add ready status) ---');
  try {
    await db.query('BEGIN');

    // 1. Drop check constraints for status on orders and bookings
    const result = await db.query(`
      SELECT conname, relname 
      FROM pg_constraint 
      JOIN pg_class ON conrelid = pg_class.oid 
      WHERE pg_class.relname IN ('orders', 'bookings') AND contype = 'c';
    `);

    for (const row of result.rows) {
      if (row.conname.includes('status')) {
        await db.query(`ALTER TABLE ${row.relname} DROP CONSTRAINT "${row.conname}"`);
        console.log(`Dropped constraint ${row.conname} on ${row.relname}`);
      }
    }

    // 2. Add new check constraints including 'ready'
    await db.query(`
      ALTER TABLE orders 
      ADD CONSTRAINT orders_status_check 
      CHECK (status IN ('pending', 'ready', 'completed', 'cancelled'))
    `);
    
    await db.query(`
      ALTER TABLE bookings 
      ADD CONSTRAINT bookings_status_check 
      CHECK (status IN ('confirmed', 'pending', 'ready', 'completed', 'cancelled'))
    `);

    await db.query('COMMIT');
    console.log('Migration 11 successful.');
    process.exit(0);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Migration 11 failed:', err);
    process.exit(1);
  }
}

migrate();
