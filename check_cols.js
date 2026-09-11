const db = require('./server/db');

async function run() {
  const m = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='messages'`);
  console.log('messages cols:', m.rows.map(x => x.column_name));

  const c = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='clients'`);
  console.log('clients cols:', c.rows.map(x => x.column_name));

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
