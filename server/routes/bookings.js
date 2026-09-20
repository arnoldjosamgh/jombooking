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
const { sendPushToSeller, sendPushToClient } = require('./push');

/**
 * generateSlots(businessId, dateStr, serviceId)
 * Uses the service's duration_minutes if provided, else falls back to business default.
 * Filters out already-booked AND manually-blocked slots.
 */
async function generateSlots(tenantDb, businessId, dateStr, serviceId, overrideDuration) {
  // Get business hours
  const bizResult = await tenantDb.query(
    `SELECT open_time, close_time, session_duration_minutes, open_days, lunch_start, lunch_end, max_clients_per_slot
     FROM businesses WHERE id = $1`,
    [businessId]
  );
  if (bizResult.rows.length === 0) throw new Error('Business not found');
  const { open_time, close_time, session_duration_minutes, open_days, lunch_start, lunch_end, max_clients_per_slot } = bizResult.rows[0];
  const maxClients = max_clients_per_slot || 1;

  // Check if business is open on this day
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay();
  if (!open_days.includes(dayOfWeek)) return [];

  // Priority: client-supplied override (multi-service total) > service duration > business default
  let duration = parseInt(overrideDuration) || session_duration_minutes;
  if (!overrideDuration && serviceId) {
    const svcRes = await tenantDb.query('SELECT duration_minutes FROM services WHERE id = $1', [serviceId]);
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

  // Build all possible slot timestamps
  const allSlots = [];
  const lunchSlots = new Set();
  
  for (let m = openMinutes; m + duration <= closeMinutes; m += duration) {
    const h   = Math.floor(m / 60);
    const min = m % 60;
    const slotTime = `${dateStr}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;
    
    // Check if slot overlaps with the lunch break
    if (lunchStartMin !== null && m < lunchEndMin && m + duration > lunchStartMin) {
      lunchSlots.add(slotTime);
    }
    allSlots.push(slotTime);
  }

  // Count confirmed bookings for each slot
  const bookedRes = await tenantDb.query(
    `SELECT TO_CHAR(booking_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS slot, COUNT(*) as count
     FROM bookings
     WHERE business_id = $1
       AND ($2::int IS NULL OR service_id = $2)
       AND DATE(booking_time) = $3::date
       AND status = 'confirmed'
     GROUP BY slot`,
    [businessId, serviceId || null, dateStr]
  );
  const bookedCounts = {};
  bookedRes.rows.forEach(r => { bookedCounts[r.slot] = parseInt(r.count); });

  // Manually blocked slots for this service on this date
  const blockedRes = await tenantDb.query(
    `SELECT TO_CHAR(slot_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS slot
     FROM blocked_slots
     WHERE business_id = $1
       AND ($2::int IS NULL OR service_id = $2)
       AND DATE(slot_time) = $3::date`,
    [businessId, serviceId || null, dateStr]
  );
  const blockedSet = new Set(blockedRes.rows.map(r => r.slot));

  return allSlots.map(slot => {
    const isLunch = lunchSlots.has(slot);
    const booked = bookedCounts[slot] || 0;
    return {
      time: slot,
      available: !isLunch && (booked < maxClients) && !blockedSet.has(slot),
      blocked_by_seller: blockedSet.has(slot),
      is_lunch_break: isLunch
    };
  });
}

// ─── GET /api/slots/:business_slug?date=&service_id= ─────────────────────────
router.get('/:business_slug', async (req, res) => {
  try {
    const { date, service_id, duration } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Query param ?date=YYYY-MM-DD is required' });
    }
    const bizResult = await db.query('SELECT id FROM businesses WHERE slug = $1', [req.params.business_slug]);
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Business not found' });

    const slots = await generateSlots(req.tenantDb, bizResult.rows[0].id, date, service_id || null, duration || null);
    res.json({ date, slots });
  } catch (err) {
    console.error('[slots] GET error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/bookings ───────────────────────────────────────────────────────
router.post('/', requireFields('business_id', 'booking_time'), async (req, res) => {
  try {
    const { business_id, client_id, booking_time, service_id, service_ids } = req.body;

    // Support multi-service cart (service_ids array) OR legacy single service_id
    const serviceIdsArray = service_ids && Array.isArray(service_ids) && service_ids.length
      ? service_ids
      : (service_id ? [service_id] : []);
    const primaryServiceId = serviceIdsArray[0] || null;

    // Compute total duration & price from services
    let totalDuration = 0;
    let totalPrice = 0;
    let serviceNames = [];
    if (serviceIdsArray.length > 0) {
      const svcRes = await req.tenantDb.query(
        `SELECT id, name, duration_minutes, price FROM services WHERE id = ANY($1::int[])`,
        [serviceIdsArray]
      );
      svcRes.rows.forEach(s => {
        totalDuration += parseInt(s.duration_minutes) || 0;
        totalPrice += parseFloat(s.price) || 0;
        serviceNames.push(s.name);
      });
    }

    const result = await req.tenantDb.query(
      `INSERT INTO bookings (business_id, client_id, booking_time, service_id, service_ids, total_duration, total_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed') RETURNING *`,
      [business_id, client_id, booking_time, primaryServiceId, JSON.stringify(serviceIdsArray), totalDuration, totalPrice]
    );

    // Auto-generate receipt number
    await req.tenantDb.query(
      `UPDATE bookings SET receipt_number = 'ORD-' || LPAD(id::text, 5, '0') WHERE id = $1`,
      [result.rows[0].id]
    );

    const full = await req.tenantDb.query(
      `SELECT b.id, b.booking_time, b.status, b.created_at, b.service_ids, b.total_duration, b.total_price,
              c.name AS client_name, c.location AS client_location,
              biz.owner_id, biz.name AS business_name,
              s.name AS service_name, s.price AS service_price
       FROM bookings b
       LEFT JOIN clients c   ON b.client_id = c.id
       JOIN businesses biz ON b.business_id = biz.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.id = $1`,
      [result.rows[0].id]
    );

    const bookingData = full.rows[0];
    bookingData.service_names = serviceNames;

    if (bookingData.owner_id) {
      const svcLabel = serviceNames.length > 1 ? `${serviceNames.length} services` : (serviceNames[0] || 'a slot');
      sendPushToSeller(bookingData.owner_id, {
        title: `New Booking — ${bookingData.business_name}`,
        body: `${bookingData.client_name} booked ${svcLabel} for ${new Date(bookingData.booking_time).toLocaleString()}.`,
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
// Accepts business_id (numeric) OR business slug
router.get('/list/:business_id', async (req, res) => {
  try {
    const { date, status, service_id } = req.query;
    const bizParam = req.params.business_id;
    const isNumeric = /^\d+$/.test(bizParam);
    const bizFilter = isNumeric
      ? 'b.business_id = $1'
      : 'b.business_id = (SELECT id FROM businesses WHERE slug = $1 LIMIT 1)';

    let query = `
      SELECT b.id, b.booking_time, b.status, b.created_at, b.updated_at, b.service_id, b.seller_id,
             b.receipt_number, b.service_ids, b.total_duration, b.total_price,
             c.id AS client_id, c.name AS client_name, c.location AS client_location,
             s.name AS service_name, s.price AS service_price, s.duration_minutes,
             sel.username AS seller_username,
             biz.name AS business_name, biz.location AS business_location,
             biz.phone_number AS business_phone, biz.logo_url AS business_logo
      FROM bookings b
      JOIN clients c  ON b.client_id = c.id
      JOIN businesses biz ON b.business_id = biz.id
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN sellers sel ON b.seller_id = sel.id
      WHERE ${bizFilter}
    `;
    const params = [bizParam];
    if (date)       { params.push(date);       query += ` AND DATE(b.booking_time) = $${params.length}::date`; }
    if (status)     { params.push(status);     query += ` AND b.status = $${params.length}`; }
    if (service_id) { params.push(service_id); query += ` AND b.service_id = $${params.length}`; }
    if (status === 'completed') {
      query += ' ORDER BY COALESCE(b.updated_at, b.created_at, b.booking_time) DESC LIMIT 300';
    } else {
      query += ' ORDER BY b.booking_time ASC LIMIT 300';
    }

    const result = await req.tenantDb.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[bookings] GET /list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/bookings/:id/status ───────────────────────────────────────────
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, final_price } = req.body;
    if (!['confirmed', 'ready', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const result = await req.tenantDb.query(
      `UPDATE bookings SET status = $1, seller_id = $2, price = COALESCE($3, price), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING id, status, price, business_id, client_id`,
      [status, req.user.id, final_price !== undefined ? final_price : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];

    // Push notification to client on ready or completed
    if ((status === 'ready' || status === 'completed') && booking.client_id) {
      try {
        const infoRes = await req.tenantDb.query(
          `SELECT b.slug, b.name AS biz_name, b.logo_url, s.name AS svc_name
           FROM bookings bk
           JOIN businesses b ON bk.business_id = b.id
           LEFT JOIN services s ON bk.service_id = s.id
           WHERE bk.id = $1`, [req.params.id]
        );
        if (infoRes.rows.length > 0) {
          const info = infoRes.rows[0];
          if (status === 'ready') {
            sendPushToClient(booking.client_id, {
              type: 'order-ready',
              title: 'Your Booking is Ready',
              body: `${info.svc_name || 'Your service'} is ready. Collect now!`,
              url: `/book.html?slug=${info.slug}`,
              icon: info.logo_url
            });
          } else if (status === 'completed') {
            sendPushToClient(booking.client_id, {
              type: 'download-receipt',
              title: 'Receipt Ready — Download Now',
              body: `Your receipt for ${info.svc_name || 'your service'} is ready. Tap to download.`,
              url: `/book.html?slug=${info.slug}&action=download-receipt&booking_id=${req.params.id}`,
              icon: info.logo_url
            });
            // Also emit socket event to client room for instant download
            const io = req.app.get('io');
            if (io) {
              const room = `chat-${booking.business_id}-${booking.client_id}`;
              io.to(room).emit('booking:completed', { bookingId: req.params.id, bizSlug: info.slug });
            }
          }
        }
      } catch (pushErr) {
        console.error('[bookings] Push/notify error:', pushErr.message);
      }
    }

    // Emit socket event to update TV display
    const io = req.app.get('io');
    if (io) {
      const bizRes = await db.query('SELECT pusher_channel FROM businesses WHERE id = $1', [booking.business_id]);
      if (bizRes.rows.length > 0) {
        const channel = bizRes.rows[0].pusher_channel || `biz-${booking.business_id}`;
        io.to(`seller-${channel}`).emit('order:status', { bookingId: req.params.id, status });
      }
    }

    res.json(booking);
  } catch (err) {
    console.error('[bookings] PATCH status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/bookings/:id/cancel — Cancel with reason, auto-message client ─
router.patch('/:id/cancel', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const bookingId = req.params.id;

    // Get booking info for messaging
    const bookingRes = await req.tenantDb.query(
      `SELECT b.id, b.business_id, b.client_id, b.booking_time, b.service_id,
              c.name AS client_name, s.name AS service_name
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.id = $1`,
      [bookingId]
    );
    if (bookingRes.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const bk = bookingRes.rows[0];

    // Update status
    await req.tenantDb.query(
      `UPDATE bookings SET status = 'cancelled', seller_id = $1 WHERE id = $2`,
      [req.user.id, bookingId]
    );

    // Send cancellation reason as a message to the client
    const svcLabel = bk.service_name || 'your appointment';
    const timeLabel = new Date(bk.booking_time).toLocaleString();
    const msgContent = reason
      ? `Your booking for ${svcLabel} on ${timeLabel} has been cancelled.\n\nReason: ${reason}`
      : `Your booking for ${svcLabel} on ${timeLabel} has been cancelled by the seller.`;

    const msgResult = await req.tenantDb.query(
      `INSERT INTO messages (business_id, client_id, sender, content)
       VALUES ($1, $2, 'seller', $3) RETURNING id, sender, content, created_at`,
      [bk.business_id, bk.client_id, msgContent]
    );
    const msg = msgResult.rows[0];

    // Emit via socket to client room
    const io = req.app.get('io');
    if (io) {
      const room = `chat-${bk.business_id}-${bk.client_id}`;
      io.to(room).emit('chat:message', msg);
      // Also emit a dedicated cancellation event the client UI listens to
      io.to(room).emit('booking:cancelled', { bookingId: bookingId, reason: reason || null });
    }

    // Send push notification to client about the cancellation
    if (bk.client_id) {
      try {
        const bizRes = await db.query('SELECT slug, logo_url FROM businesses WHERE id = $1', [bk.business_id]);
        const biz = bizRes.rows[0] || {};
        sendPushToClient(bk.client_id, {
          type: 'cancelled',
          title: 'Booking Cancelled',
          body: reason
            ? `Your ${svcLabel} booking was cancelled. Reason: ${reason}`
            : `Your ${svcLabel} booking was cancelled by the seller.`,
          url: `/book.html?slug=${biz.slug || ''}`,
          icon: biz.logo_url || null
        });
      } catch (pushErr) {
        console.error('[bookings] cancel push error:', pushErr.message);
      }
    }

    res.json({ ok: true, message_sent: msg });
  } catch (err) {
    console.error('[bookings] cancel error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

// ─── AUTO-RESCHEDULE EXPIRED BOOKINGS ────────────────────────────────────────
// Called nightly — finds confirmed bookings that have already passed
// and moves each one to the next available slot, messaging the client.
module.exports.rescheduleExpiredBookings = async function rescheduleExpiredBookings(io) {
  try {
    // Find all confirmed bookings where the time is in the past
    const expired = await db.query(
      `SELECT b.id, b.business_id, b.client_id, b.service_id, b.booking_time,
              c.name AS client_name,
              s.name AS service_name
       FROM bookings b
       JOIN clients c ON b.client_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.status = 'confirmed'
         AND b.booking_time < NOW()`
    );

    if (expired.rows.length === 0) {
      console.log('[Reschedule] No expired bookings to process.');
      return;
    }

    console.log(`[Reschedule] Processing ${expired.rows.length} expired booking(s)...`);

    for (const bk of expired.rows) {
      // Try up to 14 days ahead to find a free slot
      let newSlot = null;
      let newDate = null;
      for (let daysAhead = 1; daysAhead <= 14; daysAhead++) {
        const candidate = new Date();
        candidate.setDate(candidate.getDate() + daysAhead);
        const dateStr = candidate.toISOString().split('T')[0];

        const slots = await generateSlots(db, bk.business_id, dateStr, bk.service_id);
        const free  = slots.find(s => s.available);
        if (free) {
          newSlot = free.time;
          newDate = dateStr;
          break;
        }
      }

      if (!newSlot) {
        console.log(`[Reschedule] Booking #${bk.id}: no free slot found in next 14 days — skipping.`);
        continue;
      }

      // Move the booking to the new slot
      await db.query(
        `UPDATE bookings SET booking_time = $1 WHERE id = $2`,
        [newSlot, bk.id]
      );

      // Notify the client via message
      const svcLabel  = bk.service_name || 'your appointment';
      const oldTime   = new Date(bk.booking_time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      const newTime   = new Date(newSlot + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      const msgContent = `📅 Your booking for ${svcLabel} on ${oldTime} was missed and has been automatically rescheduled to ${newTime}.\n\nIf this doesn't work for you, please contact us to adjust.`;

      const msgResult = await db.query(
        `INSERT INTO messages (business_id, client_id, content, sender)
         VALUES ($1, $2, $3, 'seller') RETURNING *`,
        [bk.business_id, bk.client_id, msgContent]
      );

      // Emit realtime notification to client if online
      if (io) {
        const room = `chat-${bk.business_id}-${bk.client_id}`;
        io.to(room).emit('chat:message', msgResult.rows[0]);
      }

      console.log(`[Reschedule] Booking #${bk.id} (${bk.client_name}) → rescheduled to ${newSlot}`);
    }
  } catch (err) {
    console.error('[Reschedule] Error during rescheduling:', err.message);
  }
};
