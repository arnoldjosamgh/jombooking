require('dotenv').config({ path: '../.env' });
const db = require('./db');

async function migrate() {
  try {
    console.log('Running MoMo/Table columns migration...');
    
    await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number VARCHAR(20);`);
    console.log('Added table_number');

    await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash';`);
    console.log('Added payment_method');

    await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending';`);
    console.log('Added payment_status');

    await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) DEFAULT 0;`);
    console.log('Added amount_paid');

    await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_remaining NUMERIC(10,2) DEFAULT 0;`);
    console.log('Added balance_remaining');

    console.log('Migration completed successfully.');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    process.exit(0);
  }
}

migrate();
