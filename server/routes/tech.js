const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { authenticate } = require('./auth');
const { requireFields } = require('../middleware/validate');

// Middleware: tech admin only
const requireTech = (req, res, next) => {
  if (req.user.role !== 'tech') return res.status(403).json({ error: 'Tech admin only' });
  next();
};

// ─── Create Company & Multiple Seller Accounts ───────────────────────────────
// "number" = how many seller accounts to create for this company (1 business, N sellers)
router.post('/business', authenticate, requireTech,
  requireFields('prefix', 'count', 'type'), async (req, res) => {
  const client = await db.connect();
  try {
    const { prefix, count, type, biz_name, logo_url } = req.body;

    const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z]/g, '');
    if (cleanPrefix.length < 3 || cleanPrefix.length > 4) {
      return res.status(400).json({ error: 'Prefix must be 3 or 4 letters.' });
    }

    const numAccounts = Math.max(1, Math.min(parseInt(count) || 1, 50));
    const companyName = biz_name && biz_name.trim() ? biz_name.trim() : `${cleanPrefix} Business`;
    const slug = `${cleanPrefix.toLowerCase()}-${type}-${crypto.randomBytes(3).toString('hex')}`;

    await client.query('BEGIN');

    // Create the shared business first (owner_id = null initially)
    const bizResult = await client.query(
      `INSERT INTO businesses (owner_id, name, type, slug, pusher_channel, status, logo_url)
       VALUES (NULL, $1, $2, $3, $4, 'active', $5) RETURNING id, slug`,
      [companyName, type, slug, `channel-${slug}`, logo_url || null]
    );
    const businessId = bizResult.rows[0].id;
    const finalSlug = bizResult.rows[0].slug;

    // Create N seller accounts, all linked to this business
    const sellers = [];
    for (let i = 1; i <= numAccounts; i++) {
      const paddedNum = String(i).padStart(3, '0');
      const username = `${cleanPrefix}${paddedNum}`;
      const setupToken = crypto.randomBytes(32).toString('hex');

      // Check if username already exists
      const existing = await client.query('SELECT id FROM sellers WHERE LOWER(username) = LOWER($1)', [username]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: `Username ${username} already exists. Use a different prefix or delete the existing company first.` });
      }

      const sellerResult = await client.query(
        `INSERT INTO sellers (username, role, setup_token, name, business_id)
         VALUES ($1, 'owner', $2, $3, $4) RETURNING id`,
        [username, setupToken, companyName, businessId]
      );
      const sellerId = sellerResult.rows[0].id;

      // Set first seller as owner_id for the business
      if (i === 1) {
        await client.query('UPDATE businesses SET owner_id = $1 WHERE id = $2', [sellerId, businessId]);
      }

      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const magicLink = `${protocol}://${host}/setup.html?token=${setupToken}`;

      sellers.push({ username, setupToken, magicLink, sellerId });
      console.log(`[TECH] Seller ${username} created — ${magicLink}`);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: `${numAccounts} seller account(s) created`,
      businessId,
      slug: finalSlug,
      companyName,
      sellers, // array of { username, magicLink }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[tech] Create business error:', err.message, err.stack);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A company with this slug already exists. Try a different prefix.' });
    }
    res.status(500).json({ error: err.message || 'Server error' });
  } finally {
    client.release();
  }
});

// ─── List All Businesses ──────────────────────────────────────────────────────
router.get('/businesses', authenticate, requireTech, async (req, res) => {
  try {
    // Return one row per business, with all its seller usernames as an array
    const result = await db.query(`
      SELECT
        b.id, b.name, b.type, b.slug, b.status,
        json_agg(json_build_object(
          'seller_id', s.id,
          'username', s.username,
          'is_setup', s.password_hash IS NOT NULL,
          'setup_token', s.setup_token
        ) ORDER BY s.id) AS sellers
      FROM businesses b
      LEFT JOIN sellers s ON s.business_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[tech] List businesses error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Toggle Pause/Active ───────────────────────────────────────────────────────
router.put('/business/:id/toggle-pause', authenticate, requireTech, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE businesses
       SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END
       WHERE id = $1 RETURNING id, status`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Business not found' });
    res.json({ id: result.rows[0].id, status: result.rows[0].status });
  } catch (err) {
    console.error('[tech] Toggle pause error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Delete Company (cascade wipes everything) ────────────────────────────────
router.delete('/business/:id', authenticate, requireTech, async (req, res) => {
  const client = await db.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    // sellers.business_id has ON DELETE SET NULL (we must null it first to avoid FK issues with owner_id)
    await client.query('UPDATE sellers SET business_id = NULL WHERE business_id = $1', [id]);
    // Delete business — cascades to products, orders, bookings, messages, services, blocked_slots
    await client.query('DELETE FROM businesses WHERE id = $1', [id]);
    // Delete all sellers that no longer have a business
    await client.query(`DELETE FROM sellers WHERE business_id IS NULL AND role = 'owner'`);
    await client.query('COMMIT');
    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[tech] Delete business error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
