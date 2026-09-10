/**
 * Jomish Booking and Delivering Management System — Client Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireFields } = require('../middleware/validate');

// POST /api/clients — Register or retrieve client
router.post('/', requireFields('name', 'location'), async (req, res) => {
  try {
    const { name, location, photo_url } = req.body;
    const result = await db.query(
      `INSERT INTO clients (name, location, photo_url)
       VALUES ($1, $2, $3)
       RETURNING id, name, location, photo_url, seller_note, created_at`,
      [name.trim(), location.trim(), photo_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[clients] POST / error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clients/:id — Get client profile
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, location, photo_url, seller_note, created_at FROM clients WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[clients] GET /:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/clients/:id/note — Update seller note (auto-saved on blur)
router.patch('/:id/note', async (req, res) => {
  try {
    const { note } = req.body;
    const result = await db.query(
      `UPDATE clients SET seller_note = $1 WHERE id = $2
       RETURNING id, seller_note`,
      [note || '', req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[clients] PATCH /:id/note error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clients — List all clients for a business (seller view)
router.get('/', async (req, res) => {
  try {
    const { business_id } = req.query;
    let query = `SELECT DISTINCT c.id, c.name, c.location, c.photo_url, c.seller_note, c.created_at
                 FROM clients c`;
    const params = [];
    if (business_id) {
      query += ` WHERE c.id IN (
        SELECT client_id FROM orders WHERE business_id = $1
        UNION
        SELECT client_id FROM bookings WHERE business_id = $1
      )`;
      params.push(business_id);
    }
    query += ' ORDER BY c.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[clients] GET / error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
