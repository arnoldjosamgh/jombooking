require('dotenv').config();
const db = require('./db');

async function check() {
  const sellers = await db.query(
    `SELECT id, username, role, password_hash IS NOT NULL as has_pw, business_id FROM sellers WHERE role='owner'`
  );
  
  for (const s of sellers.rows) {
    const biz = await db.query(
      `SELECT id, name, slug, status FROM businesses WHERE id = $1 OR owner_id = $2 ORDER BY id LIMIT 1`,
      [s.business_id || -999, s.id]
    );
    console.log(`${s.username} (has_pw:${s.has_pw}, biz_id:${s.business_id}) => biz: ${biz.rows[0]?.slug || 'NONE'}`);
  }
  process.exit(0);
}

check().catch(e => { console.error(e.message); process.exit(1); });
