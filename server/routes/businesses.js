/**
 * Jomish Booking and Delivering Management System — Business Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('./auth');

// GET /api/businesses/manifest/:slug — Get dynamic PWA manifest (must be BEFORE /:slug wildcard)
router.get('/manifest/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.query('SELECT name, logo_url FROM businesses WHERE slug = $1', [slug]);
    const biz = result.rows[0];
    const businessName = biz && biz.name ? biz.name : 'Jomish BDM';
    const logoUrl = biz && biz.logo_url ? biz.logo_url : null;
    const shortName = businessName.length > 12 ? businessName.substring(0, 12) : businessName;
    const initial = shortName.charAt(0).toUpperCase();
    
    const defaultIconSvg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23f4a81d'/><text x='50%25' y='65%25' font-size='50' text-anchor='middle' fill='%23050c1a' font-family='sans-serif'>${initial}</text></svg>`;
    
    // Fallback to our initial SVG if no custom logo is set
    const icons = [];
    if (logoUrl) {
      icons.push({ src: logoUrl, sizes: '192x192 512x512', type: 'image/png' });
      icons.push({ src: logoUrl, sizes: '192x192 512x512', type: 'image/jpeg', purpose: 'any maskable' });
    } else {
      icons.push({ src: defaultIconSvg, sizes: '192x192', type: 'image/svg+xml' });
      icons.push({ src: defaultIconSvg, sizes: '512x512', type: 'image/svg+xml' });
    }

    const manifest = {
      name: businessName,
      short_name: shortName,
      description: 'Booking and delivery management platform',
      start_url: '/seller',
      display: 'standalone',
      background_color: '#050c1a',
      theme_color: '#f4a81d',
      icons: icons
    };
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json(manifest);
  } catch (err) {
    console.error('[businesses] GET /manifest/:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/businesses/:slug — Get business config
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.query(
      `SELECT id, name, type, slug, logo_url, open_time, close_time,
              open_days, session_duration_minutes, currency_symbol, pusher_channel,
              lunch_start, lunch_end, status, phone_number, location, low_stock_threshold
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
      open_days,
      session_duration_minutes,
      max_clients_per_slot,
      lunch_start,
      lunch_end,
      currency_symbol,
      phone_number,
      location,
      low_stock_threshold,
      mtn_momo_number,
      airtel_momo_number,
      momo_code
    } = req.body;

    // Parse duration — empty string or 0 should keep existing
    const duration = session_duration_minutes ? parseInt(session_duration_minutes) : null;
    const maxClients = max_clients_per_slot ? parseInt(max_clients_per_slot) : 1;

    const result = await db.query(
      `UPDATE businesses SET
         open_time = COALESCE($1, open_time),
         close_time = COALESCE($2, close_time),
         open_days = COALESCE($3, open_days),
         session_duration_minutes = COALESCE($4, session_duration_minutes),
         max_clients_per_slot = COALESCE($5, max_clients_per_slot),
         lunch_start = $6,
         lunch_end = $7,
         currency_symbol = COALESCE($8, currency_symbol),
         phone_number = $10,
         location = $11,
         low_stock_threshold = COALESCE($12, low_stock_threshold),
         mtn_momo_number = COALESCE($13, mtn_momo_number),
         airtel_momo_number = COALESCE($14, airtel_momo_number),
         momo_code = COALESCE($15, momo_code)
       WHERE slug = $9 RETURNING id, slug`,
      [
        open_time || null,
        close_time || null,
        open_days ? open_days : null,
        duration,
        maxClients,
        lunch_start || null,
        lunch_end || null,
        currency_symbol || null,
        slug,
        phone_number || null,
        location || null,
        low_stock_threshold ? parseInt(low_stock_threshold) : 10,
        mtn_momo_number || null,
        airtel_momo_number || null,
        momo_code || null
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
