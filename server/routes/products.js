/**
 * Jomish Booking System — Products & Orders Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireFields } = require('../middleware/validate');

// GET /api/products/:business_slug — List all products for a business
router.get('/:business_slug', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.title, p.description, p.price, p.image_url, p.stock_quantity
       FROM products p
       JOIN businesses b ON p.business_id = b.id
       WHERE b.slug = $1
       ORDER BY p.id`,
      [req.params.business_slug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[products] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/orders — Place order with atomic stock decrement
router.post('/', requireFields('business_id', 'client_id', 'product_id', 'quantity'), async (req, res) => {
  const client = await db.connect();
  try {
    const { business_id, client_id, product_id, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    await client.query('BEGIN');

    // Atomic stock decrement — if no rows updated, stock is 0
    const stockResult = await client.query(
      `UPDATE products
       SET stock_quantity = stock_quantity - $1
       WHERE id = $2 AND stock_quantity >= $1
       RETURNING id, stock_quantity`,
      [qty, product_id]
    );

    if (stockResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Out of stock or insufficient quantity' });
    }

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (business_id, client_id, product_id, quantity, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [business_id, client_id, product_id, qty]
    );

    await client.query('COMMIT');

    // Fetch full order details for real-time notification
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

// GET /api/orders/:business_id — Get all orders for seller dashboard
router.get('/list/:business_id', async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT o.id, o.quantity, o.status, o.created_at,
             p.title AS product_title, p.price,
             c.id AS client_id, c.name AS client_name, c.location AS client_location
      FROM orders o
      JOIN products p ON o.product_id = p.id
      JOIN clients c ON o.client_id = c.id
      WHERE o.business_id = $1
    `;
    const params = [req.params.business_id];
    if (status) {
      query += ` AND o.status = $2`;
      params.push(status);
    }
    query += ' ORDER BY o.created_at DESC LIMIT 100';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[orders] GET /list/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/orders/:id/status — Update order status
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
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[orders] PATCH /:id/status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
