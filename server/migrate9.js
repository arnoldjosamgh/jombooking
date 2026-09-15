/**
 * Migration 9 — Create tv_media table for TV Display slideshow
 */
require('dotenv').config();
const db = require('./db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS tv_media (
        id          SERIAL PRIMARY KEY,
        business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
        type        VARCHAR(10) NOT NULL CHECK (type IN ('image', 'video', 'text')),
        content     TEXT NOT NULL,
        title       TEXT,
        duration    INT DEFAULT 6,
        sort_order  INT DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tv_media_business ON tv_media(business_id, sort_order);
    `);
    console.log('[migrate9] ✅ tv_media table created successfully.');
  } catch (err) {
    console.error('[migrate9] ❌ Error:', err.message);
  } finally {
    process.exit();
  }
}

migrate();
