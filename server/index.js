/**
 * Jomish Booking and Delivering Management System — Express + Socket.io Server
 * Entry point for the entire backend
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const Pusher = require('pusher');

const app = express();
const server = http.createServer(app);

// ─── Socket.io Setup ──────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
app.set('io', io); // Make io available in routes via req.app.get('io')

// ─── Pusher Setup ─────────────────────────────────────────────────────────────
let pusher = null;
if (
  process.env.PUSHER_APP_ID &&
  process.env.PUSHER_KEY &&
  process.env.PUSHER_SECRET &&
  process.env.PUSHER_CLUSTER
) {
  pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  });
  console.log('[Pusher] Initialized successfully');
} else {
  console.log('[Pusher] No credentials found — running without Pusher (Socket.io only)');
}
app.set('pusher', pusher);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve PWA static frontend
app.use(express.static(path.join(__dirname, '..', 'client')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/businesses', require('./routes/businesses'));
app.use('/api/clients',    require('./routes/clients'));
app.use('/api/products',   require('./routes/products'));
app.use('/api/orders',     require('./routes/products'));   // orders POSTed through products route
app.use('/api/slots',      require('./routes/bookings'));
app.use('/api/bookings',   require('./routes/bookings'));
app.use('/api/messages',   require('./routes/messages'));
app.use('/api/auth',       require('./routes/auth').router);
app.use('/api/tech',       require('./routes/tech'));
app.use('/api/push',       require('./routes/push').router);

// ─── Pusher: Notify Seller on Order (I'm Waiting button) ─────────────────────
app.post('/api/notify/order', async (req, res) => {
  try {
    const { channel, orderId, clientName, productTitle, quantity } = req.body;
    if (pusher && channel) {
      await pusher.trigger(channel, 'order:waiting', {
        orderId, clientName, productTitle, quantity,
        timestamp: new Date().toISOString(),
      });
    }
    // Also emit via Socket.io to seller room
    io.to(`seller-${channel}`).emit('order:waiting', {
      orderId, clientName, productTitle, quantity,
      timestamp: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notify] order error:', err.message);
    res.status(500).json({ error: 'Notification failed' });
  }
});

// ─── Pusher: Notify Seller on Booking ────────────────────────────────────────
app.post('/api/notify/booking', async (req, res) => {
  try {
    const { channel, bookingId, clientName, bookingTime } = req.body;
    if (pusher && channel) {
      await pusher.trigger(channel, 'booking:new', {
        bookingId, clientName, bookingTime,
        timestamp: new Date().toISOString(),
      });
    }
    io.to(`seller-${channel}`).emit('booking:new', {
      bookingId, clientName, bookingTime,
      timestamp: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notify] booking error:', err.message);
    res.status(500).json({ error: 'Notification failed' });
  }
});

// ─── Socket.io Connection Handlers ────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Client joins a chat room
  socket.on('join:chat', ({ businessId, clientId }) => {
    const room = `chat-${businessId}-${clientId}`;
    socket.join(room);
    console.log(`[Socket.io] ${socket.id} joined room ${room}`);
  });

  // Seller joins their dashboard room (receives all notifications)
  socket.on('join:seller', ({ channel }) => {
    socket.join(`seller-${channel}`);
    console.log(`[Socket.io] Seller joined: seller-${channel}`);
  });

  // Slot availability refresh — broadcast to all clients viewing same business/date
  socket.on('join:slots', ({ businessId, date }) => {
    socket.join(`slots-${businessId}-${date}`);
  });

  // Broadcast slot update to others viewing same date
  socket.on('slot:booked', ({ businessId, date, time }) => {
    socket.to(`slots-${businessId}-${date}`).emit('slot:taken', { time });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// ─── SPA Fallback (serve index.html for all unmatched routes) ─────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Jomish Booking and Delivering Management System running on http://localhost:${PORT}`);
  console.log(`   Order flow:   http://localhost:${PORT}/order/jomish-cafe`);
  console.log(`   Booking flow: http://localhost:${PORT}/book/jomish-salon`);
  console.log(`   Seller view:  http://localhost:${PORT}/seller\n`);
});

module.exports = { app, server, io };
