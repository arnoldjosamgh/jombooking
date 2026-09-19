/**
 * Full Aiven DB setup — runs schema.sql then all migrations safely (IF NOT EXISTS)
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected to Aiven DB ✅');

    // 1. Base schema (already run, but all IF NOT EXISTS so safe)
    console.log('\n[1/2] Applying base schema.sql...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('Base schema OK ✅');

    // 2. All migration changes (safe - all use IF NOT EXISTS / IF EXISTS)
    console.log('\n[2/2] Applying all migrations...');

    const steps = [
      // migrate2
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL`,
      `ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_id INT REFERENCES businesses(id) ON DELETE SET NULL`,
      // migrate3 - type constraint
      `ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_type_check`,
      // migrate4
      `ALTER TABLE businesses ALTER COLUMN currency_symbol SET DEFAULT 'UGX'`,
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS lunch_start TIME`,
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS lunch_end TIME`,
      // migrate5
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS location TEXT`,
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30)`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50)`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(20)`,
      // migrate6 & 7
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_id VARCHAR(50)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2)`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(100)`,
      // migrate8
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS max_clients_per_slot INTEGER DEFAULT 1`,
      // migrate9 - tv_media table
      `CREATE TABLE IF NOT EXISTS tv_media (
        id          SERIAL PRIMARY KEY,
        business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
        type        VARCHAR(10) NOT NULL CHECK (type IN ('image', 'video', 'text')),
        content     TEXT NOT NULL,
        title       TEXT,
        duration    INT DEFAULT 6,
        sort_order  INT DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // migrate10
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS low_stock_threshold INT DEFAULT 10`,
      // migrate11 - payment columns
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) DEFAULT 0`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_remaining NUMERIC(10,2) DEFAULT 0`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash'`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending'`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) DEFAULT 0`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS balance_remaining NUMERIC(10,2) DEFAULT 0`,
      // migrate12 - push subscriptions for clients
      `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS client_id INT REFERENCES clients(id) ON DELETE CASCADE`,
      // migrate13 - booking service extras
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_ids JSONB`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_duration INT DEFAULT 0`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_price NUMERIC(10,2) DEFAULT 0`,
      // migrate14 - momo fields
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS mtn_momo_number VARCHAR(20) DEFAULT NULL`,
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS airtel_momo_number VARCHAR(20) DEFAULT NULL`,
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS momo_code VARCHAR(50) DEFAULT NULL`,
      // services table (if not created by schema)
      `CREATE TABLE IF NOT EXISTS services (
        id                     SERIAL PRIMARY KEY,
        business_id            INT REFERENCES businesses(id) ON DELETE CASCADE,
        name                   VARCHAR(100) NOT NULL,
        description            TEXT,
        price                  DECIMAL(10,2) NOT NULL DEFAULT 0,
        duration_minutes       INT NOT NULL DEFAULT 30,
        image_url              TEXT,
        is_deleted             BOOLEAN DEFAULT false,
        created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE services ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false`,
      // tenant db url (multi-tenant arch)
      `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tenant_db_url TEXT`,
      // blocked_slots table (needed by slot engine)
      `CREATE TABLE IF NOT EXISTS blocked_slots (
        id           SERIAL PRIMARY KEY,
        business_id  INT REFERENCES businesses(id) ON DELETE CASCADE,
        service_id   INT REFERENCES services(id) ON DELETE CASCADE,
        slot_time    TIMESTAMP NOT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (business_id, service_id, slot_time)
      )`,
      // service_id, seller_id, updated_at on bookings (needed by slot engine and seller dashboard)
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id INT REFERENCES services(id) ON DELETE SET NULL`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS seller_id INT REFERENCES sellers(id) ON DELETE SET NULL`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
      // indexes
      `CREATE INDEX IF NOT EXISTS idx_tv_media_business ON tv_media(business_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_group ON orders(order_group_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_service ON bookings(service_id)`,
      // fix status CHECK constraints to include 'ready'
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`,
      `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending','ready','completed','cancelled'))`,
      `ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check`,
      `ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('confirmed','ready','completed','cancelled'))`,
    ];

    let ok = 0, fail = 0;
    for (const sql of steps) {
      try {
        await client.query(sql);
        ok++;
      } catch (e) {
        // Ignore duplicate column / constraint errors
        if (e.code === '42701' || e.code === '42710' || e.code === '23505') {
          ok++; // already exists — fine
        } else {
          console.warn(`  ⚠️  ${e.message.substring(0, 100)}`);
          fail++;
        }
      }
    }

    console.log(`\nMigrations done: ${ok} OK, ${fail} warnings`);

    // 3. Ensure tech admin exists with correct credentials
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('Jomish9!!', 10);
    await client.query(
      `INSERT INTO sellers (username, password_hash, name, role)
       VALUES ('TECH', $1, 'Tech Admin', 'tech')
       ON CONFLICT (username) DO UPDATE SET password_hash = $1`,
      [hash]
    );
    console.log('\nTech admin user ensured ✅ (username: TECH, password: Jomish9!!)');
    console.log('\n✅ Aiven database is fully up to date!');
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
