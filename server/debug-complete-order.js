/**
 * Debug complete order - calls exactly what the seller dashboard does
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    // Check what order groups actually exist
    const orders = await client.query(`SELECT id, status, order_group_id, seller_id, updated_at FROM orders LIMIT 10`);
    console.log('Orders:', JSON.stringify(orders.rows, null, 2));

    if (orders.rows.length === 0) {
      console.log('No orders found. Cannot test.');
      return;
    }

    const testOrder = orders.rows[0];
    const groupId = testOrder.order_group_id;
    console.log('\nTesting with order id:', testOrder.id, 'group id:', groupId);

    if (groupId) {
      // Test group update
      console.log('\nTesting group update...');
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE orders SET status = $1, seller_id = $2, updated_at = CURRENT_TIMESTAMP WHERE order_group_id = $3`,
        ['ready', 1, groupId]
      );
      await client.query('ROLLBACK'); // Don't actually change it
      console.log('Group update rows affected:', res.rowCount);
    } else {
      // Test single update
      console.log('\nTesting single update...');
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE orders SET status = $1, seller_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, status`,
        ['ready', 1, testOrder.id]
      );
      await client.query('ROLLBACK');
      console.log('Single update result:', res.rows);
    }

    console.log('\n✅ Query works fine - constraint is not the issue');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('Code:', err.code);
    console.error('Detail:', err.detail);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
