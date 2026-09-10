const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { authenticate } = require('./auth');
const { requireFields } = require('../middleware/validate');

// Middleware to ensure user is a tech admin
const requireTech = (req, res, next) => {
  if (req.user.role !== 'tech') {
    return res.status(403).json({ error: 'Tech admin privileges required' });
  }
  next();
};

// ─── Create Company & Seller (Tech Dashboard) ───
router.post('/business', authenticate, requireTech, requireFields('prefix', 'number', 'type'), async (req, res) => {
  const client = await db.connect();
  try {
    const { prefix, number, type } = req.body;
    const username = `${prefix}${number}`.replace(/\s+/g, '');
    const setupToken = crypto.randomBytes(32).toString('hex');
    
    await client.query('BEGIN');

    // Create Seller
    const sellerResult = await client.query(
      `INSERT INTO sellers (username, role, setup_token, name) 
       VALUES ($1, 'owner', $2, $3) RETURNING id`,
      [username, setupToken, `Owner of ${prefix} ${number}`]
    );
    const sellerId = sellerResult.rows[0].id;

    // Create Business
    const slug = `${username}-${type}`;
    const businessResult = await client.query(
      `INSERT INTO businesses (owner_id, name, type, slug, pusher_channel)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, slug`,
      [sellerId, `${prefix} ${number} Business`, type, slug, `channel-${slug}`]
    );

    await client.query('COMMIT');

    // Generate Magic Link
    const host = req.get('host');
    const protocol = req.protocol;
    const magicLink = `${protocol}://${host}/setup.html?token=${setupToken}`;

    // Mock sending email/SMS
    console.log('\n=============================================');
    console.log(`[TECH] NEW SELLER CREATED!`);
    console.log(`Username: ${username}`);
    console.log(`Magic Setup Link: ${magicLink}`);
    console.log('=============================================\n');

    res.status(201).json({
      message: 'Business created successfully',
      business: businessResult.rows[0],
      username,
      magicLink // Returned so tech admin can copy it easily in UI
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[tech] Create business error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A business or user with this prefix/number already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── List Businesses (Tech View) ───
router.get('/businesses', authenticate, requireTech, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.id, b.name, b.type, b.slug, s.username as owner_username, 
              (s.password_hash IS NOT NULL) as is_setup
       FROM businesses b
       JOIN sellers s ON b.owner_id = s.id
       ORDER BY b.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
