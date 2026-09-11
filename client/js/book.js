/**
 * Jomish — Service Booking Page Logic
 * Flow: Register → Pick Service → Pick Date → Pick Slot → Confirm
 */

let business     = null;
let client       = null;
let socket       = null;
let selectedDate = null;
let selectedSlot = null;
let selectedSvc  = null;  // { id, name, price, duration_minutes }
let booking      = null;

// ─── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const slug = getParam('slug');
  if (!slug) { renderError('No business link provided.'); return; }

  injectRegModal();

  try {
    business = await apiFetch(`/api/businesses/${slug}`);
    Session.setBusiness(business);

    if (business.type === 'product') {
      window.location.href = `/order.html?slug=${slug}`;
      return;
    }

    document.title = `Book — ${business.name} | Jomish`;
    document.getElementById('biz-name').textContent = business.name;
    document.getElementById('biz-sub').textContent  = 'Book an Appointment';

    // Show call button if business has a phone number
    if (business.phone_number) {
      const callBtn = document.getElementById('call-btn');
      if (callBtn) {
        callBtn.href = `tel:${business.phone_number}`;
        callBtn.style.display = 'flex';
      }
    }

    // Update chat title
    const chatTitle = document.getElementById('client-chat-title');
    if (chatTitle) chatTitle.textContent = `💬 Chat with ${business.name}`;

    // Register client first, then show services
    showRegistrationModal((c) => {
      client = c;
      loadAndShowServices();
      initSocket();
      // Show floating chat button once client is registered
      const floatBtn = document.getElementById('float-chat-btn');
      if (floatBtn) floatBtn.style.display = 'flex';
    });
  } catch (err) {
    renderError('Business not found. Check your link and try again.');
  }
});


// ─── STEP 1: PICK SERVICE ──────────────────────────────────────────────────────
async function loadAndShowServices() {
  const view = document.getElementById('booking-view');
  view.innerHTML = `<div class="loading-center"><div class="spinner"></div><p>Loading services…</p></div>`;

  try {
    const services = await apiFetch(`/api/services/${business.slug}`);

    if (!services.length) {
      view.innerHTML = `
        <div class="container-sm" style="padding-top:32px">
          <div class="card" style="text-align:center;padding:48px">
            <div style="font-size:2.5rem;margin-bottom:12px">📋</div>
            <h2>No Services Yet</h2>
            <p class="mt-8 text-dim">This business hasn't added any services yet. Check back soon!</p>
          </div>
        </div>`;
      return;
    }

    view.innerHTML = `
      <div class="container-sm" style="padding-top:24px">
        <div class="card" style="padding:24px">
          <h3 style="margin-bottom:4px">1. Choose a Service</h3>
          <p class="text-dim text-sm mb-16">at ${business.name}</p>
          <div class="service-list" id="service-list">
            ${services.map(s => `
              <div class="service-card" onclick="pickService(${JSON.stringify(s).replace(/"/g,'&quot;')})">
                <div class="service-card-info">
                  <div class="service-card-name">${s.name}</div>
                  <div class="service-card-meta">⏱ ${s.duration_minutes} minutes</div>
                </div>
                <div class="service-card-price">${formatCurrency2(s.price)}</div>
                <div class="service-card-arrow">→</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    renderError('Could not load services: ' + err.message);
  }
}

function formatCurrency2(amount) {
  const sym = business?.currency_symbol || '$';
  return `${sym}${parseFloat(amount).toFixed(2)}`;
}

function pickService(svcObj) {
  // svcObj comes in as object
  selectedSvc  = typeof svcObj === 'string' ? JSON.parse(svcObj) : svcObj;
  selectedDate = todayStr();
  showDateSlotStep();
}

// ─── STEP 2: PICK DATE + SLOT ──────────────────────────────────────────────────
function showDateSlotStep() {
  const view = document.getElementById('booking-view');
  view.innerHTML = `
    <div class="container-sm" style="padding-top:24px">

      <div class="flex items-center gap-8 mb-16" style="cursor:pointer" onclick="loadAndShowServices()">
        <span style="font-size:1.2rem">←</span>
        <span class="text-dim text-sm">Back to services</span>
      </div>

      <div class="card mb-16" style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="font-bold">${selectedSvc.name}</div>
          <div class="text-dim text-sm">⏱ ${selectedSvc.duration_minutes} min &bull; ${formatCurrency2(selectedSvc.price)}</div>
        </div>
        <span class="badge badge-blue">Selected</span>
      </div>

      <div class="card" style="padding:24px">
        <h3 style="margin-bottom:16px">2. Select Date</h3>
        <div class="calendar-strip" id="calendar-strip"></div>

        <hr class="divider">

        <h3 style="margin-bottom:16px">3. Select Time</h3>
        <div id="slots-container">
          <div class="loading-center"><div class="spinner"></div></div>
        </div>
      </div>

      <div class="card mt-16" id="confirm-panel" style="display:none;padding:24px">
        <h3 style="margin-bottom:16px">4. Confirm Booking</h3>
        <div class="flex justify-between items-center mb-8 text-sm">
          <span class="text-dim">Service</span>
          <span class="font-bold">${selectedSvc.name}</span>
        </div>
        <div class="flex justify-between items-center mb-8 text-sm">
          <span class="text-dim">Duration</span>
          <span class="font-bold">${selectedSvc.duration_minutes} min</span>
        </div>
        <div class="flex justify-between items-center mb-8 text-sm">
          <span class="text-dim">Price</span>
          <span class="font-bold">${formatCurrency2(selectedSvc.price)}</span>
        </div>
        <div class="flex justify-between items-center mb-20 text-sm">
          <span class="text-dim">Time</span>
          <span class="font-bold" id="confirm-time"></span>
        </div>
        <button class="btn btn-primary btn-full" id="confirm-btn" onclick="confirmBooking()">Confirm Booking →</button>
      </div>

    </div>
  `;

  renderCalendarStrip();
  loadSlots(selectedDate);
}

// ─── CALENDAR STRIP ────────────────────────────────────────────────────────────
function renderCalendarStrip() {
  const strip = document.getElementById('calendar-strip');
  if (!strip) return;
  const days = [];
  const now  = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d);
  }
  strip.innerHTML = days.map(d => {
    const str    = dateStr(d);
    const names  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const active = str === selectedDate;
    return `
      <div class="cal-day ${active ? 'active' : ''}" onclick="selectDate('${str}')">
        <div class="cal-day-name">${names[d.getDay()]}</div>
        <div class="cal-day-num">${d.getDate()}</div>
      </div>`;
  }).join('');
}

function selectDate(dateString) {
  selectedDate = dateString;
  selectedSlot = null;
  renderCalendarStrip();
  if (socket) socket.emit('join:slots', { businessId: business.id, date: selectedDate });
  const cp = document.getElementById('confirm-panel');
  if (cp) cp.style.display = 'none';
  loadSlots(dateString);
}

// ─── SLOT LOADING ──────────────────────────────────────────────────────────────
async function loadSlots(date) {
  const container = document.getElementById('slots-container');
  if (!container) return;
  container.innerHTML = `<div class="loading-center"><div class="spinner"></div><p>Loading slots…</p></div>`;

  try {
    const data = await apiFetch(`/api/slots/${business.slug}?date=${date}&service_id=${selectedSvc.id}`);

    if (!data.slots || data.slots.length === 0) {
      container.innerHTML = `
        <div class="text-center" style="padding:48px;color:var(--text-muted)">
          <div style="font-size:2rem;margin-bottom:12px">📅</div>
          <p>No available slots for this day.</p>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="slot-grid" id="slot-grid">${data.slots.map(renderSlotBtn).join('')}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="loading-center"><p style="color:red">${err.message}</p></div>`;
  }
}

function renderSlotBtn(slot) {
  const time = formatTime(slot.time);
  if (!slot.available) {
    return `<button class="slot-btn booked" disabled>${time} 🔒</button>`;
  }
  return `<button class="slot-btn available" id="slot-${encodeTime(slot.time)}" onclick="selectSlot('${slot.time}')">${time}</button>`;
}

function encodeTime(t) { return t.replace(/[:.]/g, '-'); }

function selectSlot(time) {
  if (selectedSlot) {
    const prev = document.getElementById(`slot-${encodeTime(selectedSlot)}`);
    if (prev) prev.classList.remove('selected');
  }
  selectedSlot = time;
  const el = document.getElementById(`slot-${encodeTime(time)}`);
  if (el) el.classList.add('selected');

  const cp = document.getElementById('confirm-panel');
  if (cp) cp.style.display = 'block';
  const ct = document.getElementById('confirm-time');
  if (ct) ct.textContent = `${formatDate(time)} at ${formatTime(time)}`;
}

// ─── CONFIRM & FINALIZE ────────────────────────────────────────────────────────
async function confirmBooking() {
  if (!selectedSlot || !client || !selectedSvc) return;
  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.textContent = 'Booking…';

  try {
    booking = await apiFetch('/api/bookings', {
      method: 'POST',
      body: {
        business_id:  business.id,
        client_id:    client.id,
        booking_time: selectedSlot,
        service_id:   selectedSvc.id,
      }
    });

    await notifySeller();
    if (socket) socket.emit('slot:booked', { businessId: business.id, date: selectedDate, time: selectedSlot });

    showBookingSuccess();
  } catch (err) {
    toast('Booking Failed', err.message, 'error');
    const el = document.getElementById(`slot-${encodeTime(selectedSlot)}`);
    if (el) { el.className = 'slot-btn booked'; el.disabled = true; }
    selectedSlot = null;
    const cp = document.getElementById('confirm-panel');
    if (cp) cp.style.display = 'none';
  } finally {
    btn.disabled = false; btn.textContent = 'Confirm Booking →';
  }
}

async function notifySeller() {
  if (!business.pusher_channel) return;
  try {
    await apiFetch('/api/notify/booking', {
      method: 'POST',
      body: { channel: business.pusher_channel, bookingId: booking.id, clientName: client.name, bookingTime: booking.booking_time }
    });
  } catch { /* non-critical */ }
}

// ─── SUCCESS ───────────────────────────────────────────────────────────────────
function showBookingSuccess() {
  document.getElementById('booking-view').innerHTML = `
    <div class="container-sm" style="padding-top:32px">
      <div class="success-screen">
        <div class="success-icon">✓</div>
        <h2>Appointment Confirmed!</h2>
        <p class="mt-8">Your booking at <strong>${business.name}</strong> is locked in.</p>
        <div class="card mt-20" style="text-align:left;padding:20px">
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Service</span>
            <span class="font-bold">${selectedSvc.name}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Date & Time</span>
            <span class="font-bold">${formatDateTime(booking.booking_time)}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Duration</span>
            <span class="font-bold">${selectedSvc.duration_minutes} minutes</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Price</span>
            <span class="font-bold">${formatCurrency2(selectedSvc.price)}</span>
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
        <button class="btn btn-outline mt-20" onclick="window.location.reload()">Book Another Appointment</button>
      </div>
    </div>
  `;
  initChat('chat-container');
}

// ─── SOCKET.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') return;
  socket = io();
  if (selectedDate) socket.emit('join:slots', { businessId: business.id, date: selectedDate });

  socket.on('slot:taken', ({ time }) => {
    const el = document.getElementById(`slot-${encodeTime(time)}`);
    if (el) { el.className = 'slot-btn booked'; el.disabled = true; el.onclick = null; }
    if (selectedSlot === time) {
      selectedSlot = null;
      const cp = document.getElementById('confirm-panel');
      if (cp) cp.style.display = 'none';
      toast('Slot Taken', 'Someone just booked that slot. Please choose another.', 'error');
    }
  });
}

// ─── CHAT ──────────────────────────────────────────────────────────────────────
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

function scrollChat() { const b = document.getElementById('chat-msgs'); if (b) b.scrollTop = b.scrollHeight; }

async function sendMsg() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !client) return;
  input.value = '';
  try {
    await apiFetch('/api/messages', { method: 'POST', body: { business_id: business.id, client_id: client.id, sender: 'client', content } });
  } catch (err) { toast('Send failed', err.message, 'error'); }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function todayStr()  { return dateStr(new Date()); }
function dateStr(d)  { return d.toISOString().split('T')[0]; }

function renderError(msg) {
  document.getElementById('booking-view').innerHTML = `
    <div class="loading-center" style="padding:80px">
      <div style="font-size:2.5rem">⚠️</div>
      <h2 style="margin-top:12px">Something went wrong</h2>
      <p>${msg}</p>
    </div>`;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── STANDALONE FLOATING CHAT (available before/after booking) ─────────────────
let clientChatOpen = false;
let clientChatLoaded = false;

function toggleClientChat() {
  const modal = document.getElementById('client-chat-modal');
  if (!modal) return;
  clientChatOpen = !clientChatOpen;
  modal.style.display = clientChatOpen ? 'flex' : 'none';
  if (clientChatOpen && !clientChatLoaded) {
    loadClientChatHistory();
    clientChatLoaded = true;
    // Join chat room via socket
    if (socket && business && client) {
      socket.emit('join:chat', { businessId: business.id, clientId: client.id });
      socket.on('chat:message', (msg) => renderClientChatMsg(msg));
    }
  }
  if (clientChatOpen) {
    setTimeout(() => {
      const box = document.getElementById('client-chat-msgs');
      if (box) box.scrollTop = box.scrollHeight;
    }, 50);
  }
}

async function loadClientChatHistory() {
  if (!business || !client) return;
  try {
    const msgs = await apiFetch(`/api/messages/${business.id}/${client.id}`);
    msgs.forEach(renderClientChatMsg);
  } catch { /* no history */ }
}

function renderClientChatMsg(msg) {
  const box = document.getElementById('client-chat-msgs');
  if (!box) return;
  const isMe = msg.sender === 'client';
  const el = document.createElement('div');
  el.style.cssText = `display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'};`;
  el.innerHTML = `
    <div style="max-width:85%; padding:8px 12px; border-radius:12px; font-size:0.84rem; ${isMe ? 'background:#5b67f6; color:#fff;' : 'background:#e2e8f0; color:#1a2461;'}">
      ${msg.content}
    </div>
    <div style="font-size:0.65rem; color:#94a3b8; margin-top:2px;">${formatTime(msg.created_at)}</div>
  `;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

async function sendClientMsg() {
  const input = document.getElementById('client-chat-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content || !client || !business) return;
  input.value = '';
  try {
    const msg = await apiFetch('/api/messages', {
      method: 'POST',
      body: { business_id: business.id, client_id: client.id, sender: 'client', content }
    });
    renderClientChatMsg(msg);
  } catch (err) {
    toast('Send failed', err.message, 'error');
  }
}
