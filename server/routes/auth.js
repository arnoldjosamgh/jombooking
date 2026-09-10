const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { requireFields } = require('../middleware/validate');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_local_dev';
const RP_ID = process.env.RP_ID || 'localhost'; // Relaying Party ID for WebAuthn (must be localhost or domain)
const RP_NAME = 'Jomish Booking and Delivering Management System';

// Temporary store for WebAuthn challenges
const userChallenges = {};

// ─── Regular Login (Password) ───
router.post('/login', requireFields('username', 'password'), async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await db.query('SELECT * FROM sellers WHERE username = $1', [username]);
    
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

    // Set role
    const role = seller.is_admin ? 'tech' : 'owner';

    // If owner, fetch their primary business slug
    let business_slug = null;
    if (!seller.is_admin) {
      const bizRes = await db.query('SELECT slug FROM businesses WHERE owner_id = $1 LIMIT 1', [seller.id]);
      if (bizRes.rows.length > 0) business_slug = bizRes.rows[0].slug;
    }

    // Success — generate token
    const token = jwt.sign({ id: seller.id, role, username: seller.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, seller: { id: seller.id, username: seller.username, role, name: seller.name }, business_slug });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Setup Password via Magic Link ───
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

    const jwtToken = jwt.sign({ id: seller.id, role: seller.role, username: seller.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Password set successfully', token: jwtToken, seller: { id: seller.id, username: seller.username, role: seller.role } });
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
    const seller = await db.query('SELECT username FROM sellers WHERE id = $1', [sellerId]);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: String(sellerId), // Must be string or Buffer
      userName: seller.rows[0].username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
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
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: req.headers.origin || `http://${RP_ID}:3000`,
        expectedRPID: RP_ID,
      });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ error: error.message });
    }

    const { verified, registrationInfo } = verification;
    
    if (verified && registrationInfo) {
      const { credentialPublicKey, credentialID, counter } = registrationInfo;
      
      // Store public key as base64 for easy DB storage
      const pubKeyBase64 = Buffer.from(credentialPublicKey).toString('base64');
      const credIdBase64 = Buffer.from(credentialID).toString('base64');

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

// ─── WebAuthn Authentication (Login) ───
router.post('/webauthn/auth-options', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const result = await db.query('SELECT id, webauthn_cred_id FROM sellers WHERE username = $1', [username]);
    if (result.rows.length === 0 || !result.rows[0].webauthn_cred_id) {
      return res.status(400).json({ error: 'Biometrics not set up for this user' });
    }

    const seller = result.rows[0];
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: [{
        id: Buffer.from(seller.webauthn_cred_id, 'base64'),
        type: 'public-key',
        transports: ['internal'],
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
    const result = await db.query('SELECT * FROM sellers WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });
    
    const seller = result.rows[0];
    const expectedChallenge = userChallenges[seller.id];

    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge not found' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: response,
        expectedChallenge,
        expectedOrigin: req.headers.origin || `http://${RP_ID}:3000`,
        expectedRPID: RP_ID,
        authenticator: {
          credentialID: Buffer.from(seller.webauthn_cred_id, 'base64'),
          credentialPublicKey: Buffer.from(seller.webauthn_pub_key, 'base64'),
          counter: seller.webauthn_counter,
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ error: error.message });
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
