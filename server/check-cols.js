require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

p.query("SELECT column_name FROM information_schema.columns WHERE table_name='businesses'")
  .then(r => {
    console.log('businesses columns:', r.rows.map(x => x.column_name).join(', '));
    return p.query("SELECT column_name FROM information_schema.columns WHERE table_name='sellers'");
  })
  .then(r => {
    console.log('sellers columns:', r.rows.map(x => x.column_name).join(', '));
    p.end();
  })
  .catch(e => { console.error(e.message); p.end(); });
