/**
 * Jomish Booking and Delivering Management System — Bookings & Slot Engine Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireFields } = require('../middleware/validate');
const { sendPushToSeller } = require('./push');

/**
 * Slot Engine — generates time slots for a given date and business
 * Filters out already-booked slots from the database
 */
async function generateSlots(businessId, dateStr) {
  // Get business config
  const bizResult = await db.query(
    `SELECT open_time, close_time, session_duration_minutes, open_days
     FROM businesses WHERE id = $1`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw new Error('Business not found');
  const { open_time, close_time, session_duration_minutes, open_days } = bizResult.rows[0];

  // Check if business is open on the requested day
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
  if (!open_days.includes(dayOfWeek)) {
    return []; // Closed this day
  }

  // Parse open/close times
  const [openH, openM] = open_time.split(':').map(Number);
  const [closeH, closeM] = close_time.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  const duration = session_duration_minutes;

  // Generate all possible slots
  const allSlots = [];
  for (let m = openMinutes; m + duration <= closeMinutes; m += duration) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const slotTime = `${dateStr}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    allSlots.push(slotTime);
  }

  // Get already-booked slots
  const bookedResult = await db.query(
    `SELECT TO_CHAR(booking_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS slot
     FROM bookings
     WHERE business_id = $1
       AND DATE(booking_time) = $2::date
       AND status != 'cancelled'`,
    [businessId, dateStr]
  );
  const bookedSet = new Set(bookedResult.rows.map(r => r.slot));

  // Mark slots as available or booked
  return allSlots.map(slot => ({
    time: slot,
    available: !bookedSet.has(slot),
  }));
}

// GET /api/slots/:business_slug?date=YYYY-MM-DD — Slot engine
router.get('/:business_slug', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Query param ?date=YYYY-MM-DD is required' });
    }

    const bizResult = await db.query(
      'SELECT id FROM businesses WHERE slug = $1',
      [req.params.business_slug]
    );
    if (bizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const slots = await generateSlots(bizResult.rows[0].id, date);
    res.json({ date, slots });
  } catch (err) {
    console.error('[slots] GET error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bookings — Lock a slot (UNIQUE constraint handles double-booking)
router.post('/', requireFields('business_id', 'client_id', 'booking_time'), async (req, res) => {
  try {
    const { business_id, client_id, booking_time } = req.body;

    const result = await db.query(
      `INSERT INTO bookings (business_id, client_id, booking_time, status)
       VALUES ($1, $2, $3, 'confirmed')
       RETURNING *`,
      [business_id, client_id, booking_time]
    );

    // Return full booking with client info
    const full = await db.query(
      `SELECT b.id, b.booking_time, b.status, b.created_at,
              c.name AS client_name, c.location AS client_location,
              biz.owner_id, biz.name AS business_name
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       JOIN businesses biz ON b.business_id = biz.id
       WHERE b.id = $1`,
      [result.rows[0].id]
    );

    const bookingData = full.rows[0];

    // Trigger Web Push Notification to the Seller
    if (bookingData.owner_id) {
      sendPushToSeller(bookingData.owner_id, {
        title: `📅 New Booking at ${bookingData.business_name}`,
        body: `${bookingData.client_name} booked a slot for ${new Date(bookingData.booking_time).toLocaleString()}.`,
        url: '/seller.html'
      });
    }

    res.status(201).json(bookingData);
  } catch (err) {
    if (err.code === '23505') {
      // Unique violation — slot already taken
      return res.status(409).json({ error: 'This time slot is already booked. Please choose another.' });
    }
    console.error('[bookings] POST / error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/bookings/list/:business_id — Get all bookings for seller dashboard
router.get('/list/:business_id', async (req, res) => {
  try {
    const { date, status } = req.query;
    let query = `
      SELECT b.id, b.booking_time, b.status, b.created_at,
             c.id AS client_id, c.name AS client_name, c.location AS client_location
      FROM bookings b
      JOIN clients c ON b.client_id = c.id
      WHERE b.business_id = $1
    `;
    const params = [req.params.business_id];
    if (date) {
      params.push(date);
      query += ` AND DATE(b.booking_time) = $${params.length}::date`;
    }
    if (status) {
      params.push(status);
      query += ` AND b.status = $${params.length}`;
    }
    query += ' ORDER BY b.booking_time ASC LIMIT 200';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[bookings] GET /list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/bookings/:id/status — Update booking status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    const result = await db.query(
      `UPDATE bookings SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[bookings] PATCH /:id/status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
