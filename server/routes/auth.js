const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { requireFields } = require('../middleware/validate');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_local_dev';
const RP_NAME = 'Jomish Business Suite';

// Helper: derive RP_ID and expected origin from the incoming request
// This makes biometrics work on any device (Android, iOS, desktop, localhost)
function getRpConfig(req) {
  const host = (req.headers.origin || req.headers.host || 'localhost');
  let origin = host.startsWith('http') ? host : `http://${host}`;
  // Normalise: strip port for RP_ID, keep full origin for expectedOrigin
  let rpId;
  try {
    const u = new URL(origin);
    rpId = process.env.RP_ID || u.hostname; // env override wins for production
    origin = u.origin;
  } catch (_) {
    rpId = process.env.RP_ID || 'localhost';
  }
  return { rpId, origin };
}

// Temporary store for WebAuthn challenges
const userChallenges = {};

// ─── Regular Login (Password) ───
router.post('/login', requireFields('username', 'password'), async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await db.query('SELECT * FROM sellers WHERE LOWER(username) = LOWER($1)', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const seller = result.rows[0];
    if (!seller.password_hash) {
      return res.status(401).json({ error: 'Account not set up yet. Please use your setup link.' });
    }

    const valid = await bcrypt.compare(password, seller.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Set role from DB column
    const role = seller.role === 'tech' ? 'tech' : 'owner';

    // If owner, fetch their business (via seller.business_id or owner_id)
    let business_slug = null;
    if (role !== 'tech') {
      let bizRes;
      if (seller.business_id) {
        // Preferred: direct business_id link (multi-seller companies)
        bizRes = await db.query(
          `SELECT slug, status FROM businesses WHERE id = $1 LIMIT 1`,
          [seller.business_id]
        );
      }
      if (!bizRes || bizRes.rows.length === 0) {
        // Fallback: check if this seller is the owner of a business
        bizRes = await db.query(
          `SELECT slug, status FROM businesses WHERE owner_id = $1 ORDER BY id LIMIT 1`,
          [seller.id]
        );
      }
      if (bizRes.rows.length > 0) {
        if (bizRes.rows[0].status === 'paused') {
          return res.status(403).json({ error: 'This business account is currently paused. Please contact support.' });
        }
        business_slug = bizRes.rows[0].slug;
      }
    }

    // Success — generate token
    const token = jwt.sign({ id: seller.id, role, username: seller.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, seller: { id: seller.id, username: seller.username, role, name: seller.name }, business_slug, has_biometrics: !!seller.webauthn_cred_id });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Demo Login — Read-only simulator mode ───
router.post('/demo-login', async (req, res) => {
  try {
    const { type } = req.body; // 'product' or 'service'
    const demoSlug = type === 'service' ? 'jomish-salon' : 'jomish-cafe';

    // Check if the demo business exists
    const bizRes = await db.query('SELECT id, slug, name FROM businesses WHERE slug = $1', [demoSlug]);
    let bizSlug = demoSlug;
    if (bizRes.rows.length > 0) {
      bizSlug = bizRes.rows[0].slug;
    }

    // Issue a special demo token (does not correspond to a real seller)
    const token = jwt.sign(
      { id: 0, role: 'owner', username: 'DEMO', is_demo: true, demo_type: type || 'product' },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({
      token,
      seller: { id: 0, username: 'DEMO', role: 'owner', name: 'Demo User', is_demo: true },
      business_slug: bizSlug
    });
  } catch (err) {
    console.error('[auth] Demo login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/setup-password', requireFields('token', 'password'), async (req, res) => {
  try {
    const { token, password } = req.body;
    const result = await db.query('SELECT * FROM sellers WHERE setup_token = $1', [token]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired setup token' });
    }

    const seller = result.rows[0];
    const hash = await bcrypt.hash(password, 10);

    // Clear token, set password
    await db.query(
      'UPDATE sellers SET password_hash = $1, setup_token = NULL WHERE id = $2',
      [hash, seller.id]
    );

    const role = seller.role || 'owner';

    // Fetch business slug for this seller (prefer business_id, fallback to owner_id)
    let business_slug = null;
    let bizRes;
    if (seller.business_id) {
      bizRes = await db.query(
        `SELECT slug FROM businesses WHERE id = $1 LIMIT 1`,
        [seller.business_id]
      );
    }
    if (!bizRes || bizRes.rows.length === 0) {
      bizRes = await db.query(
        `SELECT slug FROM businesses WHERE owner_id = $1 ORDER BY id LIMIT 1`,
        [seller.id]
      );
    }
    if (bizRes.rows.length > 0) business_slug = bizRes.rows[0].slug;

    const jwtToken = jwt.sign({ id: seller.id, role, username: seller.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      message: 'Password set successfully',
      token: jwtToken,
      seller: { id: seller.id, username: seller.username, role, name: seller.name },
      business_slug
    });
  } catch (err) {
    console.error('[auth] Setup password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Middleware: Require Auth ───
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.get('/me', authenticate, async (req, res) => {
  const result = await db.query('SELECT id, username, name, role, webauthn_cred_id FROM sellers WHERE id = $1', [req.user.id]);
  res.json(result.rows[0]);
});

// ─── WebAuthn Registration (Biometrics) ───
router.post('/webauthn/register-options', authenticate, async (req, res) => {
  try {
    const sellerId = req.user.id;
    if (sellerId === 0 || req.user.username === 'DEMO') {
      return res.status(400).json({ error: 'Biometrics are not supported for the Demo account.' });
    }

    const seller = await db.query('SELECT username FROM sellers WHERE id = $1', [sellerId]);
    if (seller.rows.length === 0) {
      return res.status(400).json({ error: 'User not found.' });
    }

    const { rpId, origin } = getRpConfig(req);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId,
      userID: new Uint8Array(Buffer.from(String(sellerId))),
      userName: seller.rows[0].username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform', // prefers built-in biometric (Face/Fingerprint)
      },
      // Support all transport types so Android, iOS, and desktop all work
      supportedAlgorithmIDs: [-7, -257],
    });

    userChallenges[sellerId] = options.challenge;
    res.json(options);
  } catch (error) {
    console.error('[webauthn] Register options error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/webauthn/register-verify', authenticate, async (req, res) => {
  try {
    const sellerId = req.user.id;
    const expectedChallenge = userChallenges[sellerId];
    
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge not found or expired' });
    }

    const body = req.body;
    const { rpId, origin } = getRpConfig(req);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });
    } catch (error) {
      console.error('[webauthn] register-verify error:', error.message);
      return res.status(400).json({ error: 'Biometric registration failed: ' + error.message });
    }

    const { verified, registrationInfo } = verification;
    
    if (verified && registrationInfo) {
      // v14 API: credential is nested under registrationInfo.credential
      const { credential } = registrationInfo;
      const credId = credential.id;             // Base64URLString in v14
      const pubKeyBytes = credential.publicKey; // Uint8Array
      const counter = credential.counter;

      const credIdBase64 = typeof credId === 'string'
        ? credId
        : Buffer.from(credId).toString('base64url');
      const pubKeyBase64 = Buffer.from(pubKeyBytes).toString('base64');

      await db.query(
        'UPDATE sellers SET webauthn_cred_id = $1, webauthn_pub_key = $2, webauthn_counter = $3 WHERE id = $4',
        [credIdBase64, pubKeyBase64, counter, sellerId]
      );
      
      delete userChallenges[sellerId];
      res.json({ verified: true });
    } else {
      res.status(400).json({ error: 'Verification failed' });
    }
  } catch (error) {
    console.error('[webauthn] Register verify error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── WebAuthn Reset (clear credential) ───
router.post('/webauthn/reset', authenticate, async (req, res) => {
  try {
    await db.query(
      'UPDATE sellers SET webauthn_cred_id = NULL, webauthn_pub_key = NULL, webauthn_counter = 0 WHERE id = $1',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WebAuthn Authentication (Login) ───
router.post('/webauthn/auth-options', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const result = await db.query('SELECT id, webauthn_cred_id FROM sellers WHERE LOWER(username) = LOWER($1)', [username]);
    if (result.rows.length === 0 || !result.rows[0].webauthn_cred_id) {
      return res.status(400).json({ error: 'Biometrics not set up for this user' });
    }

    const seller = result.rows[0];
    const { rpId } = getRpConfig(req);
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: [{
        id: seller.webauthn_cred_id, // already stored as Base64URLString
        type: 'public-key',
      }],
      userVerification: 'preferred',
    });

    userChallenges[seller.id] = options.challenge;
    res.json(options);
  } catch (error) {
    console.error('[webauthn] Auth options error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/webauthn/auth-verify', async (req, res) => {
  try {
    const { username, response } = req.body;
    const result = await db.query('SELECT * FROM sellers WHERE LOWER(username) = LOWER($1)', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });
    
    const seller = result.rows[0];
    const expectedChallenge = userChallenges[seller.id];

    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge not found' });

    const { rpId, origin } = getRpConfig(req);

    // Decode stored credential for v14 API
    const credId = seller.webauthn_cred_id; // stored as base64url string
    const pubKeyBytes = new Uint8Array(Buffer.from(seller.webauthn_pub_key, 'base64'));

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        // v14 API: use 'credential' not 'authenticator'
        credential: {
          id: credId,
          publicKey: pubKeyBytes,
          counter: seller.webauthn_counter || 0,
        },
      });
    } catch (error) {
      console.error('[webauthn] auth-verify error:', error.message);
      return res.status(400).json({ error: 'Biometric verification failed. Please try your password instead.' });
    }

    const { verified, authenticationInfo } = verification;

    if (verified) {
      await db.query('UPDATE sellers SET webauthn_counter = $1 WHERE id = $2', [authenticationInfo.newCounter, seller.id]);
      delete userChallenges[seller.id];
      
      const token = jwt.sign({ id: seller.id, role: seller.role, username: seller.username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ verified: true, token, seller: { id: seller.id, username: seller.username, role: seller.role, name: seller.name } });
    } else {
      res.status(400).json({ error: 'Verification failed' });
    }
  } catch (error) {
    console.error('[webauthn] Auth verify error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, authenticate };
