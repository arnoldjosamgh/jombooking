require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
});

async function run() {
  try {
    const res = await pool.query("UPDATE sellers SET username = 'TECH' WHERE username = 'tech'");
    console.log(`Updated ${res.rowCount} row(s)`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}

run();
