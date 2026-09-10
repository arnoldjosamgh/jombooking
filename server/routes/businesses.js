/**
 * Jomish Booking System — Business Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/businesses/:slug — Get business config
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.query(
      `SELECT id, name, type, slug, logo_url, open_time, close_time,
              open_days, session_duration_minutes, currency_symbol, pusher_channel
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

// GET /api/businesses — List all businesses (for testing/admin)
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
