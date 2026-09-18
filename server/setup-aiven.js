require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('aivencloud') ? { rejectUnauthorized: false } : false
});

async function run() {
  try {
    console.log('Connecting to Aiven DB...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    
    console.log('Executing schema.sql...');
    await pool.query(schemaSql);
    
    console.log('✅ Schema created successfully!');

    // Create tech admin user if it doesn't exist
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('admin123', 10);
    
    const result = await pool.query(
      `INSERT INTO sellers (username, password_hash, role) 
       VALUES ('tech', $1, 'tech') 
       ON CONFLICT (username) DO NOTHING`,
       [hash]
    );

    if (result.rowCount > 0) {
      console.log('✅ Created tech admin user (username: tech, password: admin123)');
    } else {
      console.log('ℹ️ Tech admin user already exists.');
    }
  } catch (err) {
    console.error('❌ Error executing schema:', err);
  } finally {
    await pool.end();
  }
}

run();
