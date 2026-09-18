require('dotenv').config();
const {Pool} = require('pg');
const bcrypt = require('bcrypt');

const p = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

bcrypt.hash('Jomish9!!', 10)
  .then(hash => p.query("UPDATE sellers SET password_hash = $1 WHERE role = 'tech'", [hash]))
  .then(() => p.query("UPDATE sellers SET username = 'TECH' WHERE role = 'tech'"))
  .then(() => {
    console.log('Updated tech login successfully.');
    process.exit(0);
  })
  .catch(e => {
    console.log('Update password worked, but username was already TECH or conflicted.');
    process.exit(0);
  });
