/**
 * Jomish — Products & Orders Routes
 * Includes POS multi-item checkout, barcode lookup, and seller product management
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireFields } = require('../middleware/validate');
const { authenticate } = require('./auth');

// ─── GET /api/products/:business_slug ─────────────────────────────────────────
router.get('/:business_slug', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.title, p.description, p.price, p.image_url, p.stock_quantity, p.barcode
       FROM products p
       JOIN businesses b ON p.business_id = b.id
       WHERE b.slug = $1
       ORDER BY p.title`,
      [req.params.business_slug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[products] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/products/barcode/:code ──────────────────────────────────────────
router.get('/barcode/:code', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.title, p.price, p.stock_quantity, p.image_url, p.barcode
       FROM products p WHERE p.barcode = $1 LIMIT 1`,
      [req.params.code]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found for this barcode' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/products/manage ─────────────────────────────────────────────────
// Seller adds a new product to their business
router.post('/manage', authenticate, requireFields('business_id', 'title', 'price'), async (req, res) => {
  try {
    const { business_id, title, description, price, barcode, stock_quantity } = req.body;
    const result = await db.query(
      `INSERT INTO products (business_id, title, description, price, barcode, stock_quantity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [business_id, title, description || '', parseFloat(price), barcode || null, parseInt(stock_quantity || 0)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[products] POST /manage error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/products/manage/:id/stock ──────────────────────────────────────
router.patch('/manage/:id/stock', authenticate, async (req, res) => {
  try {
    const { stock_quantity } = req.body;
    const result = await db.query(
      `UPDATE products SET stock_quantity = $1 WHERE id = $2 RETURNING *`,
      [parseInt(stock_quantity), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Single item order (client-facing)
router.post('/', requireFields('business_id', 'client_id', 'product_id', 'quantity'), async (req, res) => {
  const client = await db.connect();
  try {
    const { business_id, client_id, product_id, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    await client.query('BEGIN');

    const stockResult = await client.query(
      `UPDATE products SET stock_quantity = stock_quantity - $1
       WHERE id = $2 AND stock_quantity >= $1
       RETURNING id, stock_quantity`,
      [qty, product_id]
    );

    if (stockResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Out of stock or insufficient quantity' });
    }

    const orderResult = await client.query(
      `INSERT INTO orders (business_id, client_id, product_id, quantity, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [business_id, client_id, product_id, qty]
    );

    await client.query('COMMIT');

    const fullOrder = await db.query(
      `SELECT o.id, o.quantity, o.status, o.created_at,
              p.title AS product_title, p.price,
              c.name AS client_name, c.location AS client_location
       FROM orders o
       JOIN products p ON o.product_id = p.id
       JOIN clients c ON o.client_id = c.id
       WHERE o.id = $1`,
      [orderResult.rows[0].id]
    );

    res.status(201).json(fullOrder.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders] POST / error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── POST /api/orders/pos-checkout ────────────────────────────────────────────
// POS: multi-item checkout from seller dashboard. Items = [{product_id, qty}]
router.post('/pos-checkout', authenticate, async (req, res) => {
  const client = await db.connect();
  try {
    const { business_id, items, customer_name, notes } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items in order' });

    await client.query('BEGIN');

    // Create a walk-in client record
    const clientRes = await client.query(
      `INSERT INTO clients (name, location) VALUES ($1, 'Walk-in') RETURNING id`,
      [customer_name || 'Walk-in Customer']
    );
    const clientId = clientRes.rows[0].id;

    let total = 0;
    const createdOrders = [];

    for (const item of items) {
      const qty = parseInt(item.qty);
      // Decrement stock atomically
      const stock = await client.query(
        `UPDATE products SET stock_quantity = stock_quantity - $1
         WHERE id = $2 AND stock_quantity >= $1
         RETURNING id, title, price`,
        [qty, item.product_id]
      );
      if (stock.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Insufficient stock for product #${item.product_id}` });
      }
      const price = parseFloat(stock.rows[0].price);
      total += price * qty;

      const order = await client.query(
        `INSERT INTO orders (business_id, client_id, product_id, quantity, status, total_price, notes)
         VALUES ($1, $2, $3, $4, 'completed', $5, $6) RETURNING id`,
        [business_id, clientId, item.product_id, qty, price * qty, notes || null]
      );
      createdOrders.push({ id: order.rows[0].id, product: stock.rows[0].title, qty, price });
    }

    await client.query('COMMIT');

    res.status(201).json({ success: true, total, items: createdOrders, client_id: clientId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pos-checkout] error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── GET /api/orders/list/:business_id ────────────────────────────────────────
router.get('/list/:business_id', async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT o.id, o.quantity, o.status, o.created_at, o.total_price, o.notes,
             p.title AS product_title, p.price,
             c.id AS client_id, c.name AS client_name, c.location AS client_location
      FROM orders o
      JOIN products p ON o.product_id = p.id
      JOIN clients c ON o.client_id = c.id
      WHERE o.business_id = $1
    `;
    const params = [req.params.business_id];
    if (status) { query += ` AND o.status = $2`; params.push(status); }
    query += ' ORDER BY o.created_at DESC LIMIT 100';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[orders] GET /list/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/orders/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    const result = await db.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
