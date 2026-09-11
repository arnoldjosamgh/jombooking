/**
 * Jomish — Bookings & Slot Engine Routes
 * Slot engine is now per-service: each service can have its own duration_minutes.
 * Also supports manually blocked slots.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireFields }  = require('../middleware/validate');
const { authenticate }   = require('./auth');
const { sendPushToSeller } = require('./push');

/**
 * generateSlots(businessId, dateStr, serviceId)
 * Uses the service's duration_minutes if provided, else falls back to business default.
 * Filters out already-booked AND manually-blocked slots.
 */
async function generateSlots(businessId, dateStr, serviceId) {
  // Get business hours
  const bizResult = await db.query(
    `SELECT open_time, close_time, session_duration_minutes, open_days, lunch_start, lunch_end
     FROM businesses WHERE id = $1`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw new Error('Business not found');
  const { open_time, close_time, session_duration_minutes, open_days, lunch_start, lunch_end } = bizResult.rows[0];

  // Check if business is open on this day
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay();
  if (!open_days.includes(dayOfWeek)) return [];

  // Use the service's own duration if we have a service, else the business default
  let duration = session_duration_minutes;
  if (serviceId) {
    const svcRes = await db.query('SELECT duration_minutes FROM services WHERE id = $1', [serviceId]);
    if (svcRes.rows.length > 0) duration = svcRes.rows[0].duration_minutes;
  }

  const [openH, openM] = open_time.split(':').map(Number);
  const [closeH, closeM] = close_time.split(':').map(Number);
  const openMinutes  = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  // Lunch window in minutes (if set)
  let lunchStartMin = null, lunchEndMin = null;
  if (lunch_start && lunch_end) {
    const [lsh, lsm] = lunch_start.split(':').map(Number);
    const [leh, lem] = lunch_end.split(':').map(Number);
    lunchStartMin = lsh * 60 + lsm;
    lunchEndMin   = leh * 60 + lem;
  }

  // Build all possible slot timestamps, skipping lunch
  const allSlots = [];
  for (let m = openMinutes; m + duration <= closeMinutes; m += duration) {
    // Skip slots that overlap with the lunch break
    if (lunchStartMin !== null && m < lunchEndMin && m + duration > lunchStartMin) continue;
    const h   = Math.floor(m / 60);
    const min = m % 60;
    allSlots.push(`${dateStr}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`);
  }

  // Booked slots for this service on this date
  const bookedRes = await db.query(
    `SELECT TO_CHAR(booking_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS slot
     FROM bookings
     WHERE business_id = $1
       AND ($2::int IS NULL OR service_id = $2)
       AND DATE(booking_time) = $3::date
       AND status != 'cancelled'`,
    [businessId, serviceId || null, dateStr]
  );
  const bookedSet = new Set(bookedRes.rows.map(r => r.slot));

  // Manually blocked slots for this service on this date
  const blockedRes = await db.query(
    `SELECT TO_CHAR(slot_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS slot
     FROM blocked_slots
     WHERE business_id = $1
       AND ($2::int IS NULL OR service_id = $2)
       AND DATE(slot_time) = $3::date`,
    [businessId, serviceId || null, dateStr]
  );
  const blockedSet = new Set(blockedRes.rows.map(r => r.slot));

  return allSlots.map(slot => ({
    time: slot,
    available: !bookedSet.has(slot) && !blockedSet.has(slot),
    blocked_by_seller: blockedSet.has(slot),
  }));
}

// ─── GET /api/slots/:business_slug?date=&service_id= ─────────────────────────
router.get('/:business_slug', async (req, res) => {
  try {
    const { date, service_id } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Query param ?date=YYYY-MM-DD is required' });
    }
    const bizResult = await db.query('SELECT id FROM businesses WHERE slug = $1', [req.params.business_slug]);
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Business not found' });

    const slots = await generateSlots(bizResult.rows[0].id, date, service_id || null);
    res.json({ date, slots });
  } catch (err) {
    console.error('[slots] GET error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/bookings ───────────────────────────────────────────────────────
router.post('/', requireFields('business_id', 'client_id', 'booking_time'), async (req, res) => {
  try {
    const { business_id, client_id, booking_time, service_id } = req.body;

    const result = await db.query(
      `INSERT INTO bookings (business_id, client_id, booking_time, service_id, status)
       VALUES ($1, $2, $3, $4, 'confirmed') RETURNING *`,
      [business_id, client_id, booking_time, service_id || null]
    );

    const full = await db.query(
      `SELECT b.id, b.booking_time, b.status, b.created_at,
              c.name AS client_name, c.location AS client_location,
              biz.owner_id, biz.name AS business_name,
              s.name AS service_name, s.price AS service_price
       FROM bookings b
       JOIN clients c   ON b.client_id = c.id
       JOIN businesses biz ON b.business_id = biz.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.id = $1`,
      [result.rows[0].id]
    );

    const bookingData = full.rows[0];

    if (bookingData.owner_id) {
      sendPushToSeller(bookingData.owner_id, {
        title: `📅 New Booking — ${bookingData.business_name}`,
        body: `${bookingData.client_name} booked ${bookingData.service_name || 'a slot'} for ${new Date(bookingData.booking_time).toLocaleString()}.`,
        url: '/seller.html'
      });
    }

    res.status(201).json(bookingData);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This time slot is already booked. Please choose another.' });
    }
    console.error('[bookings] POST error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/bookings/list/:business_id ──────────────────────────────────────
router.get('/list/:business_id', async (req, res) => {
  try {
    const { date, status, service_id } = req.query;
    let query = `
      SELECT b.id, b.booking_time, b.status, b.created_at, b.service_id, b.seller_id,
             c.id AS client_id, c.name AS client_name, c.location AS client_location,
             s.name AS service_name, s.price AS service_price, s.duration_minutes,
             sel.username AS seller_username
      FROM bookings b
      JOIN clients c  ON b.client_id = c.id
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN sellers sel ON b.seller_id = sel.id
      WHERE b.business_id = $1
    `;
    const params = [req.params.business_id];
    if (date)       { params.push(date);       query += ` AND DATE(b.booking_time) = $${params.length}::date`; }
    if (status)     { params.push(status);     query += ` AND b.status = $${params.length}`; }
    if (service_id) { params.push(service_id); query += ` AND b.service_id = $${params.length}`; }
    query += ' ORDER BY b.booking_time ASC LIMIT 300';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[bookings] GET /list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/bookings/:id/status ───────────────────────────────────────────
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const result = await db.query(
      `UPDATE bookings SET status = $1, seller_id = $2 WHERE id = $3 RETURNING id, status`,
      [status, req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
