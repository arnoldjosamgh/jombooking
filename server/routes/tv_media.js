/**
 * Jomish — TV Display Media Routes
 * Handles media items (images, videos, text banners) shown on the TV display board
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('./auth');

// ─── GET /api/tv-media/:slug — Public: get all media for a business ─────────
router.get('/:slug', async (req, res) => {
  try {
    const result = await req.tenantDb.query(
      `SELECT m.id, m.type, m.content, m.title, m.duration, m.sort_order
       FROM tv_media m
       JOIN businesses b ON m.business_id = b.id
       WHERE b.slug = $1
       ORDER BY m.sort_order ASC, m.created_at ASC`,
      [req.params.slug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[tv-media] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/tv-media/:slug — Auth: add a media item ──────────────────────
router.post('/:slug', authenticate, async (req, res) => {
  try {
    const { type, content, title, duration } = req.body;
    if (!type || !content) return res.status(400).json({ error: 'type and content are required' });
    if (!['image', 'video', 'text'].includes(type)) {
      return res.status(400).json({ error: 'type must be image, video or text' });
    }

    const bizRes = await db.query('SELECT id FROM businesses WHERE slug = $1', [req.params.slug]);
    if (!bizRes.rows.length) return res.status(404).json({ error: 'Business not found' });
    const businessId = bizRes.rows[0].id;

    // Get current max sort_order
    const maxRes = await req.tenantDb.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tv_media WHERE business_id = $1',
      [businessId]
    );
    const nextOrder = maxRes.rows[0].max_order + 1;

    const result = await req.tenantDb.query(
      `INSERT INTO tv_media (business_id, type, content, title, duration, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [businessId, type, content, title || null, duration || 6, nextOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[tv-media] POST /:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/tv-media/:id — Auth: update title / duration / text content ─
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { title, duration, content } = req.body;
    const result = await req.tenantDb.query(
      `UPDATE tv_media
       SET title    = COALESCE($1, title),
           duration = COALESCE($2, duration),
           content  = COALESCE($3, content)
       WHERE id = $4 RETURNING *`,
      [title ?? null, duration ? parseInt(duration) : null, content ?? null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[tv-media] PATCH /:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DELETE /api/tv-media/:id — Auth: remove a media item ───────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await req.tenantDb.query('DELETE FROM tv_media WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tv-media] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/tv-media/:slug/reorder — Auth: save new sort order ────────────
router.post('/:slug/reorder', authenticate, async (req, res) => {
  try {
    const { order } = req.body; // array of ids in desired order
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of ids' });
    for (let i = 0; i < order.length; i++) {
      await req.tenantDb.query('UPDATE tv_media SET sort_order = $1 WHERE id = $2', [i, order[i]]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[tv-media] POST /reorder error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
