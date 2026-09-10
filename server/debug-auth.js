require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_HNFAqn9hjlE1@ep-floral-bird-ay6flrov-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
});

async function run() {
  try {
    const hash = await bcrypt.hash('Jomish9!!', 10);
    console.log('New hash:', hash);
    const res = await pool.query(
      "UPDATE sellers SET password_hash = $1 WHERE UPPER(username) = 'TECH' RETURNING username, role",
      [hash]
    );
    console.log('Updated:', JSON.stringify(res.rows));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

run();
