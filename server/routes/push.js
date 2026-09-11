const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const db = require('../db');
const { authenticate } = require('./auth');

// Generate VAPID keys if they don't exist
// In production, these should be in .env and persistent
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@jomish.com';

let activeVapidPublicKey = null;
let keysValid = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  activeVapidPublicKey = VAPID_PUBLIC;
  keysValid = true;
  console.log('[Web Push] VAPID keys loaded successfully.');
} else {
  console.log('[Web Push] WARNING: VAPID keys missing. Generating temporary ones for local dev...');
  const vapidKeys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails(EMAIL, vapidKeys.publicKey, vapidKeys.privateKey);
  activeVapidPublicKey = vapidKeys.publicKey;
  console.log(`\nTemporary VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`Temporary VAPID_PRIVATE_KEY=${vapidKeys.privateKey}\n`);
  keysValid = true;
}

// ─── Get Public Key for Service Worker ───
router.get('/vapidPublicKey', (req, res) => {
  if (!keysValid) return res.status(500).json({ error: 'VAPID keys not configured' });
  res.send(activeVapidPublicKey);
});

// ─── Save Push Subscription ───
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const subscription = req.body;
    const sellerId = req.user.id;
    
    // Save to DB
    await db.query(
      `INSERT INTO push_subscriptions (seller_id, endpoint, p256dh, auth) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET seller_id = EXCLUDED.seller_id`,
      [sellerId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    
    res.status(201).json({ message: 'Subscription saved.' });
  } catch (err) {
    console.error('[push] Subscribe error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Utility to send push to a seller (imported elsewhere)
async function sendPushToSeller(sellerId, payload) {
  if (!keysValid) return;
  try {
    const result = await db.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE seller_id = $1', [sellerId]);
    const notifications = result.rows.map(sub => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      };
      return webpush.sendNotification(subscription, JSON.stringify(payload)).catch(err => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or unsubscribed
          db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(console.error);
        } else {
          console.error('[push] Send error:', err);
        }
      });
    });
    await Promise.all(notifications);
  } catch (err) {
    console.error('[push] sendPushToSeller error:', err);
  }
}

module.exports = { router, sendPushToSeller };
