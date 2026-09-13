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
              lunch_start, lunch_end, status, phone_number, location
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

// PUT /api/businesses/:slug/settings — Update working hours, lunch, currency, phone, location
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
      currency_symbol,
      phone_number,
      location
    } = req.body;

    // Parse duration — empty string or 0 should keep existing
    const duration = session_duration_minutes ? parseInt(session_duration_minutes) : null;

    const result = await db.query(
      `UPDATE businesses SET
         open_time = COALESCE($1, open_time),
         close_time = COALESCE($2, close_time),
         open_days = COALESCE($3, open_days),
         session_duration_minutes = COALESCE($4, session_duration_minutes),
         lunch_start = $5,
         lunch_end = $6,
         currency_symbol = COALESCE($7, currency_symbol),
         phone_number = $9,
         location = $10
       WHERE slug = $8 RETURNING id, slug`,
      [
        open_time || null,
        close_time || null,
        open_days ? open_days : null,
        duration,
        lunch_start || null,
        lunch_end || null,
        currency_symbol || null,
        slug,
        phone_number || null,
        location || null
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

// GET /api/businesses/manifest/:slug — Get dynamic PWA manifest
router.get('/manifest/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.query('SELECT name FROM businesses WHERE slug = $1', [slug]);
    const businessName = result.rows.length > 0 ? result.rows[0].name : 'Jomish BDM';
    const shortName = businessName.length > 12 ? businessName.substring(0, 12) : businessName;
    
    const manifest = {
      "name": businessName,
      "short_name": shortName,
      "description": "Booking and delivery management platform",
      "start_url": `/seller`, // Default to seller, but client will set it depending on page
      "display": "standalone",
      "background_color": "#050c1a",
      "theme_color": "#f4a81d",
      "icons": [
        {
          "src": `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23f4a81d'/><text x='50%' y='65%' font-size='50' text-anchor='middle' fill='%23050c1a' font-family='sans-serif'>${shortName.charAt(0).toUpperCase()}</text></svg>`,
          "sizes": "192x192",
          "type": "image/svg+xml"
        },
        {
          "src": `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23f4a81d'/><text x='50%' y='65%' font-size='50' text-anchor='middle' fill='%23050c1a' font-family='sans-serif'>${shortName.charAt(0).toUpperCase()}</text></svg>`,
          "sizes": "512x512",
          "type": "image/svg+xml"
        }
      ]
    };
    res.json(manifest);
  } catch (err) {
    console.error('[businesses] GET /manifest/:slug error:', err.message);
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
