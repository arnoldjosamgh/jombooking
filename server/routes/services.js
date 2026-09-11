/**
 * Jomish — Services Routes
 * Each service belongs to a business and has its own duration + price
 */
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate } = require('./auth');
const { requireFields }  = require('../middleware/validate');

// ─── GET /api/services/:business_slug — Public list for client booking ─────────
router.get('/:business_slug', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.id, s.name, s.price, s.duration_minutes
       FROM services s
       JOIN businesses b ON s.business_id = b.id
       WHERE b.slug = $1
       ORDER BY s.name`,
      [req.params.business_slug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[services] GET error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/services — Seller adds a new service ───────────────────────────
router.post('/', authenticate, requireFields('business_id', 'name', 'price', 'duration_minutes'), async (req, res) => {
  try {
    const { business_id, name, price, duration_minutes } = req.body;
    const result = await db.query(
      `INSERT INTO services (business_id, name, price, duration_minutes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [business_id, name, parseFloat(price), parseInt(duration_minutes)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[services] POST error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DELETE /api/services/:id — Seller removes a service ──────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM services WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/services/block — Block a slot (manual unavailability) ──────────
router.post('/block', authenticate, requireFields('business_id', 'service_id', 'slot_time'), async (req, res) => {
  try {
    const { business_id, service_id, slot_time } = req.body;
    await db.query(
      `INSERT INTO blocked_slots (business_id, service_id, slot_time)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [business_id, service_id, slot_time]
    );
    res.json({ ok: true, blocked: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/services/unblock — Unblock a slot ─────────────────────────────
router.post('/unblock', authenticate, async (req, res) => {
  try {
    const { business_id, service_id, slot_time } = req.body;

    if (!business_id || !slot_time) {
      return res.status(400).json({ error: 'business_id and slot_time are required' });
    }

    // Cast slot_time consistently — stored as timestamptz, compare via UTC cast
    let result;
    if (service_id) {
      result = await db.query(
        `DELETE FROM blocked_slots
         WHERE business_id = $1
           AND (service_id = $2 OR service_id IS NULL)
           AND TO_CHAR(slot_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') = $3`,
        [business_id, service_id, slot_time]
      );
    } else {
      result = await db.query(
        `DELETE FROM blocked_slots
         WHERE business_id = $1
           AND TO_CHAR(slot_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') = $2`,
        [business_id, slot_time]
      );
    }

    console.log(`[services] unblock: deleted ${result.rowCount} row(s) for biz=${business_id} slot=${slot_time}`);
    res.json({ ok: true, blocked: false });
  } catch (err) {
    console.error('[services] POST /unblock error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
