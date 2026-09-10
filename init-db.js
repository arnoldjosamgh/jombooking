require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('server/schema.sql', 'utf8');

pool.query(sql)
  .then(() => {
    console.log('✅ Schema initialized successfully on Neon!');
    pool.end();
  })
  .catch((err) => {
    console.error('❌ Error:', err.message);
    pool.end();
    process.exit(1);
  });
