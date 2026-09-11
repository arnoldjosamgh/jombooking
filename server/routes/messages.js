/**
 * Jomish Booking and Delivering Management System — Messages (In-App Chat) Routes
 * Socket.io integration for real-time bidirectional chat
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireFields } = require('../middleware/validate');

// GET /api/messages/threads/:business_id — All client threads for seller panel
router.get('/threads/:business_id', async (req, res) => {
  try {
    const { business_id } = req.params;
    const result = await db.query(
      `SELECT DISTINCT ON (m.client_id)
         m.client_id, c.name AS client_name, c.phone AS client_phone,
         m.content AS last_message, m.sender AS last_sender, m.created_at AS last_at,
         (SELECT COUNT(*) FROM messages
          WHERE business_id = $1 AND client_id = m.client_id AND sender = 'client' AND read_at IS NULL
         ) AS unread_count
       FROM messages m
       JOIN clients c ON m.client_id = c.id
       WHERE m.business_id = $1
       ORDER BY m.client_id, m.created_at DESC`,
      [business_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[messages] threads error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/:business_id/:client_id — Load chat history
router.get('/:business_id/:client_id', async (req, res) => {
  try {
    const { business_id, client_id } = req.params;
    const result = await db.query(
      `SELECT id, sender, content, created_at
       FROM messages
       WHERE business_id = $1 AND client_id = $2
       ORDER BY created_at ASC
       LIMIT 200`,
      [business_id, client_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[messages] GET error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/messages — Save message (also emitted via Socket.io in index.js)
router.post('/', requireFields('business_id', 'client_id', 'sender', 'content'), async (req, res) => {
  try {
    const { business_id, client_id, sender, content } = req.body;
    if (!['client', 'seller'].includes(sender)) {
      return res.status(400).json({ error: 'sender must be "client" or "seller"' });
    }

    const result = await db.query(
      `INSERT INTO messages (business_id, client_id, sender, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sender, content, created_at`,
      [business_id, client_id, sender, content.trim()]
    );

    // Emit to socket room — done from index.js after calling this route
    const msg = result.rows[0];
    const io = req.app.get('io');
    if (io) {
      const room = `chat-${business_id}-${client_id}`;
      io.to(room).emit('chat:message', msg);
    }

    res.status(201).json(msg);
  } catch (err) {
    console.error('[messages] POST error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
