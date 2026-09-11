/**
 * Jomish Booking and Delivering Management System — Business Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('./auth');

// GET /api/businesses/:slug — Get business config
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.query(
      `SELECT id, name, type, slug, logo_url, open_time, close_time,
              open_days, session_duration_minutes, currency_symbol, pusher_channel,
              lunch_start, lunch_end, status
       FROM businesses WHERE slug = $1`,
      [slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[businesses] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/businesses/:slug/logo — Update logo
router.put('/:slug/logo', async (req, res) => {
  try {
    const { slug } = req.params;
    const { logo_url } = req.body;
    const result = await db.query(
      'UPDATE businesses SET logo_url = $1 WHERE slug = $2 RETURNING id',
      [logo_url, slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[businesses] PUT /:slug/logo error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/businesses/:slug/settings — Update working hours, lunch, currency
router.put('/:slug/settings', authenticate, async (req, res) => {
  try {
    const { slug } = req.params;
    const {
      open_time,
      close_time,
      open_days,       // array of ints e.g. [1,2,3,4,5]
      session_duration_minutes,
      lunch_start,
      lunch_end,
      currency_symbol
    } = req.body;

    const result = await db.query(
      `UPDATE businesses SET
         open_time = COALESCE($1, open_time),
         close_time = COALESCE($2, close_time),
         open_days = COALESCE($3, open_days),
         session_duration_minutes = COALESCE($4, session_duration_minutes),
         lunch_start = $5,
         lunch_end = $6,
         currency_symbol = COALESCE($7, currency_symbol)
       WHERE slug = $8 RETURNING id, slug`,
      [
        open_time || null,
        close_time || null,
        open_days ? open_days : null,
        session_duration_minutes ? parseInt(session_duration_minutes) : null,
        lunch_start || null,
        lunch_end || null,
        currency_symbol || null,
        slug
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[businesses] PUT /:slug/settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/businesses — List all businesses (for admin)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, type, slug, logo_url, currency_symbol FROM businesses ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[businesses] GET / error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
