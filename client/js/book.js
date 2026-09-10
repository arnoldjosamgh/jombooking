/**
 * Jomish Booking and Delivering Management System — Service Booking Page Logic
 * Calendar strip, slot matrix, real-time slot locking via Socket.io
 */

let business   = null;
let client     = null;
let socket     = null;
let selectedDate = null;
let selectedSlot = null;
let booking    = null;

// ─── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const slug = getParam('slug');
  if (!slug) { renderError('No business slug provided.'); return; }

  injectRegModal();

  try {
    business = await apiFetch(`/api/businesses/${slug}`);
    Session.setBusiness(business);

    if (business.type !== 'service') {
      window.location.href = `/order.html?slug=${slug}`;
      return;
    }

    document.title = `Book Appointment — ${business.name} | Jomish`;
    document.getElementById('biz-name').textContent = business.name;
    document.getElementById('biz-sub').textContent  = `${business.session_duration_minutes}-min sessions`;

    // Set selected date to today
    selectedDate = todayStr();
    renderCalendarStrip();

    showRegistrationModal((c) => {
      client = c;
      loadSlots(selectedDate);
      initSocket();
    });
  } catch (err) {
    renderError('Business not found. Check your link and try again.');
  }
});

// ─── Calendar Strip ────────────────────────────────────────────
function renderCalendarStrip() {
  const strip = document.getElementById('calendar-strip');
  const days  = [];
  const now   = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d);
  }

  strip.innerHTML = days.map(d => {
    const str = dateStr(d);
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const isActive = str === selectedDate;
    return `
      <div class="cal-day ${isActive ? 'active' : ''}" onclick="selectDate('${str}')">
        <div class="cal-day-name">${names[d.getDay()]}</div>
        <div class="cal-day-num">${d.getDate()}</div>
      </div>
    `;
  }).join('');
}

function selectDate(dateString) {
  selectedDate = dateString;
  selectedSlot = null;
  renderCalendarStrip();

  // Re-join socket room for slot updates
  if (socket) {
    socket.emit('join:slots', { businessId: business.id, date: selectedDate });
  }
  loadSlots(dateString);
}

// ─── Slot Loading & Rendering ──────────────────────────────────
async function loadSlots(date) {
  const container = document.getElementById('slots-container');
  container.innerHTML = `<div class="loading-center"><div class="spinner"></div><p>Loading slots…</p></div>`;

  try {
    const data = await apiFetch(`/api/slots/${business.slug}?date=${date}`);

    if (!data.slots || data.slots.length === 0) {
      container.innerHTML = `
        <div class="text-center" style="padding:48px;color:var(--text-500)">
          <div style="font-size:2rem;margin-bottom:12px">📅</div>
          <p>No available slots for this day.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="slot-grid" id="slot-grid">
        ${data.slots.map(s => renderSlotBtn(s)).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="loading-center"><p style="color:var(--red-400)">${err.message}</p></div>`;
  }
}

function renderSlotBtn(slot) {
  const time = formatTime(slot.time);
  const cls  = slot.available ? 'available' : 'booked';
  const disabled = !slot.available ? 'disabled' : '';
  return `
    <button class="slot-btn ${cls}" id="slot-${encodeTime(slot.time)}"
      onclick="${slot.available ? `selectSlot('${slot.time}')` : ''}"
      ${disabled}>
      ${time}
    </button>
  `;
}

function encodeTime(t) { return t.replace(/[:.]/g, '-'); }

function selectSlot(time) {
  // Deselect previous
  if (selectedSlot) {
    const prev = document.getElementById(`slot-${encodeTime(selectedSlot)}`);
    if (prev) prev.classList.remove('selected');
  }
  selectedSlot = time;
  const el = document.getElementById(`slot-${encodeTime(time)}`);
  if (el) el.classList.add('selected');

  // Show confirmation panel
  document.getElementById('confirm-panel').style.display = 'block';
  document.getElementById('confirm-time').textContent = `${formatDate(time)} at ${formatTime(time)}`;
  document.getElementById('confirm-duration').textContent = `Duration: ${business.session_duration_minutes} minutes`;
}

// ─── Confirm Booking ───────────────────────────────────────────
async function confirmBooking() {
  if (!selectedSlot || !client) return;

  // Calculate 25% of session duration for late policy
  const duration = business.session_duration_minutes;
  const lateMins = Math.round(duration * 0.25);
  
  document.getElementById('tc-late-mins').textContent = lateMins;
  openModal('tc-modal');
}

async function finalizeBooking() {
  if (!selectedSlot || !client) return;

  const btn = document.getElementById('tc-agree-btn');
  btn.disabled = true;
  btn.textContent = 'Booking…';

  try {
    booking = await apiFetch('/api/bookings', {
      method: 'POST',
      body: {
        business_id: business.id,
        client_id: client.id,
        booking_time: selectedSlot,
      }
    });

    // Notify seller
    await notifySeller();

    // Tell other clients this slot is taken
    if (socket) {
      socket.emit('slot:booked', {
        businessId: business.id,
        date: selectedDate,
        time: selectedSlot,
      });
    }

    showBookingSuccess();
  } catch (err) {
    toast('Booking Failed', err.message, 'error');
    // Mark slot as taken in UI
    const el = document.getElementById(`slot-${encodeTime(selectedSlot)}`);
    if (el) { el.className = 'slot-btn booked'; el.disabled = true; }
    selectedSlot = null;
    document.getElementById('confirm-panel').style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = 'I Agree — Confirm';
    closeModal('tc-modal');
  }
}

async function notifySeller() {
  if (!business.pusher_channel) return;
  try {
    await apiFetch('/api/notify/booking', {
      method: 'POST',
      body: {
        channel: business.pusher_channel,
        bookingId: booking.id,
        clientName: client.name,
        bookingTime: booking.booking_time,
      }
    });
  } catch { /* non-critical */ }
}

// ─── Success Screen ────────────────────────────────────────────
function showBookingSuccess() {
  document.getElementById('booking-view').innerHTML = `
    <div class="container-sm" style="padding-top:32px">
      <div class="success-screen">
        <div class="success-icon">✓</div>
        <h2>Appointment Confirmed!</h2>
        <p class="mt-8">Your booking at ${business.name} is locked in.</p>
        <div class="card mt-20" style="text-align:left;padding:20px">
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Date & Time</span>
            <span class="font-bold">${formatDateTime(booking.booking_time)}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Duration</span>
            <span class="font-bold">${business.session_duration_minutes} minutes</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Status</span>
            <span class="badge badge-green">Confirmed</span>
          </div>
        </div>
        <div class="mt-20">
          <h3 style="margin-bottom:12px">Chat with ${business.name}</h3>
          <div id="chat-container"></div>
        </div>
        <button class="btn btn-outline mt-20" onclick="window.location.reload()">Book Another Slot</button>
      </div>
    </div>
  `;
  initChat('chat-container');
}

// ─── Socket.io — Real-time slot updates ───────────────────────
function initSocket() {
  if (typeof io === 'undefined') return;
  socket = io();
  socket.emit('join:slots', { businessId: business.id, date: selectedDate });

  // Another client booked a slot — grey it out immediately
  socket.on('slot:taken', ({ time }) => {
    const el = document.getElementById(`slot-${encodeTime(time)}`);
    if (el) {
      el.className = 'slot-btn booked';
      el.disabled = true;
      el.onclick = null;
    }
    if (selectedSlot === time) {
      selectedSlot = null;
      document.getElementById('confirm-panel').style.display = 'none';
      toast('Slot Taken', 'Someone just booked that slot. Please choose another.', 'error');
    }
  });
}

// ─── Chat ──────────────────────────────────────────────────────
async function initChat(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="chat-panel">
      <div class="chat-header">💬 Chat with seller</div>
      <div class="chat-messages" id="chat-msgs"></div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Type a message…" onkeydown="if(event.key==='Enter') sendMsg()">
        <button onclick="sendMsg()">Send</button>
      </div>
    </div>
  `;
  try {
    const msgs = await apiFetch(`/api/messages/${business.id}/${client.id}`);
    msgs.forEach(renderMsg);
  } catch { /* no history */ }

  socket.emit('join:chat', { businessId: business.id, clientId: client.id });
  socket.on('chat:message', (msg) => { renderMsg(msg); scrollChat(); });
}

function renderMsg(msg) {
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `msg-bubble ${msg.sender}`;
  el.innerHTML = `${msg.content}<div class="msg-time">${formatTime(msg.created_at)}</div>`;
  box.appendChild(el);
  scrollChat();
}

function scrollChat() {
  const box = document.getElementById('chat-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

async function sendMsg() {
  const input   = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !client) return;
  input.value = '';
  try {
    await apiFetch('/api/messages', {
      method: 'POST',
      body: { business_id: business.id, client_id: client.id, sender: 'client', content }
    });
  } catch (err) {
    toast('Send failed', err.message, 'error');
  }
}

// ─── Helpers ───────────────────────────────────────────────────
function todayStr() { return dateStr(new Date()); }
function dateStr(d) { return d.toISOString().split('T')[0]; }

function renderError(msg) {
  document.getElementById('booking-view').innerHTML = `
    <div class="loading-center" style="padding:80px">
      <div style="font-size:2.5rem">⚠️</div>
      <h2 style="margin-top:12px">Something went wrong</h2>
      <p>${msg}</p>
    </div>
  `;
}
