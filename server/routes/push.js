const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const db = require('../db');
const { authenticate } = require('./auth');

const path = require('path');
const fs   = require('fs');

// VAPID key persistence — keys are saved to vapid_keys.json so they survive restarts
// (rotating keys would invalidate all existing push subscriptions)
const VAPID_KEYS_FILE = path.join(__dirname, '..', 'vapid_keys.json');
const EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@jomish.com';
let activeVapidPublicKey = null;
let keysValid = false;

function loadOrCreateVapidKeys() {
  // 1) Prefer environment variables (production)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(EMAIL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    activeVapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    keysValid = true;
    console.log('[Web Push] VAPID keys loaded from environment.');
    return;
  }

  // 2) Load from persisted file (dev / first run)
  try {
    if (fs.existsSync(VAPID_KEYS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
      if (saved.publicKey && saved.privateKey) {
        webpush.setVapidDetails(EMAIL, saved.publicKey, saved.privateKey);
        activeVapidPublicKey = saved.publicKey;
        keysValid = true;
        console.log('[Web Push] VAPID keys loaded from vapid_keys.json');
        return;
      }
    }
  } catch (e) {
    console.warn('[Web Push] Could not read vapid_keys.json, generating new keys...', e.message);
  }

  // 3) Generate fresh keys and persist them
  const vapidKeys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails(EMAIL, vapidKeys.publicKey, vapidKeys.privateKey);
  activeVapidPublicKey = vapidKeys.publicKey;
  keysValid = true;
  try {
    fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
    console.log('[Web Push] New VAPID keys generated and saved to vapid_keys.json');
    console.log('[Web Push] Add these to your .env to use in production:');
    console.log(`  VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
    console.log(`  VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  } catch (writeErr) {
    console.error('[Web Push] Could not save vapid_keys.json:', writeErr.message);
  }
}

loadOrCreateVapidKeys();

// ─── Get Public Key for Service Worker ───
router.get('/vapidPublicKey', (req, res) => {
  if (!keysValid) return res.status(500).json({ error: 'VAPID keys not configured' });
  res.send(activeVapidPublicKey);
});

// ─── Save Push Subscription for Seller ───
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
    
    res.status(201).json({ message: 'Subscription saved for seller.' });
  } catch (err) {
    console.error('[push] Subscribe error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Save Push Subscription for Client ───
router.post('/subscribe-client', async (req, res) => {
  try {
    const { subscription, client_id } = req.body;
    if (!client_id) return res.status(400).json({ error: 'Missing client_id' });
    
    // Save to DB
    await db.query(
      `INSERT INTO push_subscriptions (client_id, endpoint, p256dh, auth) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET client_id = EXCLUDED.client_id`,
      [client_id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    
    res.status(201).json({ message: 'Subscription saved for client.' });
  } catch (err) {
    console.error('[push] Subscribe client error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Utility to send push to a seller (imported elsewhere)
async function sendPushToSeller(sellerId, payload) {
  if (!keysValid) return;
  try {
    const result = await db.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE seller_id = $1', [sellerId]);
    await sendPushToRows(result.rows, payload);
  } catch (err) {
    console.error('[push] sendPushToSeller error:', err);
  }
}

// Utility to send push to a client
async function sendPushToClient(clientId, payload) {
  if (!keysValid) return;
  try {
    const result = await db.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE client_id = $1', [clientId]);
    await sendPushToRows(result.rows, payload);
  } catch (err) {
    console.error('[push] sendPushToClient error:', err);
  }
}

async function sendPushToRows(rows, payload) {
  const notifications = rows.map(sub => {
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
}

module.exports = { router, sendPushToSeller, sendPushToClient };
