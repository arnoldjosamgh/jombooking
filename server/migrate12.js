const db = require('./db');

async function migrate() {
  console.log('--- Running Migration 12 (Add client push support) ---');
  try {
    await db.query('BEGIN');

    // Add client_id column to push_subscriptions
    await db.query(`
      ALTER TABLE push_subscriptions 
      ADD COLUMN client_id INT REFERENCES clients(id) ON DELETE CASCADE
    `);
    
    // Alter seller_id to be nullable
    await db.query(`
      ALTER TABLE push_subscriptions 
      ALTER COLUMN seller_id DROP NOT NULL
    `);

    await db.query('COMMIT');
    console.log('Migration 12 successful.');
    process.exit(0);
  } catch (err) {
    if (err.code === '42701') {
       console.log('Migration 12 skipped: column client_id already exists.');
       process.exit(0);
    }
    await db.query('ROLLBACK');
    console.error('Migration 12 failed:', err);
    process.exit(1);
  }
}

migrate();
