const db = require('./server/db');
db.query('SELECT username, role, password_hash, setup_token FROM sellers').then(res => {
  console.log(res.rows);
  process.exit(0);
});
