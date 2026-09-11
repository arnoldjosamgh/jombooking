/**
 * Jomish — Service Booking Page Logic
 * Flow: Register → Pick Service → Pick Day (dropdown) → Pick Slot (dropdown) → Confirm → Receipt
 */

let business     = null;
let client       = null;
let socket       = null;
let selectedDate = null;
let selectedSlot = null;
let selectedSvc  = null;
let booking      = null;
const sentMsgIds = new Set(); // deduplicate socket echo

// ─── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const slug = getParam('slug');
  if (!slug) { renderError('No business link provided.'); return; }

  injectRegModal();
  setupPwaPrompt();

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

    if (business.phone_number) {
      const callBtn = document.getElementById('call-btn');
      if (callBtn) { callBtn.href = `tel:${business.phone_number}`; callBtn.style.display = 'flex'; }
    }

    const chatTitle = document.getElementById('client-chat-title');
    if (chatTitle) chatTitle.textContent = `💬 Chat with ${business.name}`;

    showRegistrationModal((c) => {
      client = c;
      loadAndShowServices();
      initSocket();
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
  selectedSvc  = typeof svcObj === 'string' ? JSON.parse(svcObj) : svcObj;
  selectedDate = null;
  selectedSlot = null;
  showDateSlotStep();
}

// ─── STEP 2: PICK DATE (dropdown) → PICK SLOT (dropdown) ──────────────────────
function showDateSlotStep() {
  // Build next 14 days as dropdown options
  const days = [];
  const now  = new Date();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d);
  }

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
        <h3 style="margin-bottom:16px">2. Pick a Day</h3>
        <select id="day-select" onchange="onDaySelect(this.value)" class="login-input" style="background:#f8fafc;color:#1a2461;border:1px solid #e2e8f0;margin-bottom:0;cursor:pointer;">
          <option value="">— Choose a day —</option>
          ${days.map((d, idx) => {
            const str = dateStr(d);
            let label = `${dayNames[d.getDay()]}, ${d.getDate()} ${shortMonths[d.getMonth()]}`;
            if (idx === 0) label = `Today — ${label}`;
            else if (idx === 1) label = `Tomorrow — ${label}`;
            return `<option value="${str}">${label}</option>`;
          }).join('')}
        </select>

        <div id="slot-section" style="display:none;margin-top:20px">
          <h3 style="margin-bottom:12px">3. Pick a Time Slot</h3>
          <select id="slot-select" onchange="onSlotSelect(this.value)" class="login-input" style="background:#f8fafc;color:#1a2461;border:1px solid #e2e8f0;margin-bottom:0;cursor:pointer;">
            <option value="">— Choose a time —</option>
          </select>
          <div id="slot-loading" style="display:none" class="text-dim text-sm mt-8">Loading available slots…</div>
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
}

async function onDaySelect(dateString) {
  if (!dateString) return;
  selectedDate = dateString;
  selectedSlot = null;

  const slotSection  = document.getElementById('slot-section');
  const slotSelect   = document.getElementById('slot-select');
  const slotLoading  = document.getElementById('slot-loading');
  const confirmPanel = document.getElementById('confirm-panel');

  slotSection.style.display = 'block';
  slotSelect.innerHTML = '<option value="">Loading…</option>';
  slotSelect.disabled = true;
  if (slotLoading) slotLoading.style.display = 'block';
  if (confirmPanel) confirmPanel.style.display = 'none';

  if (socket) socket.emit('join:slots', { businessId: business.id, date: selectedDate });

  try {
    const data = await apiFetch(`/api/slots/${business.slug}?date=${dateString}&service_id=${selectedSvc.id}`);
    const now = new Date();
    
    // Filter: only available, and if today's date, must be in the future (with 5 min buffer)
    const available = (data.slots || []).filter(s => {
      if (!s.available) return false;
      // For today, hide slots that have already passed (add 5 min buffer)
      const slotTime = new Date(s.time + 'Z');
      if (dateString === dateStr(now) && slotTime <= new Date(now.getTime() + 5 * 60000)) return false;
      return true;
    });

    if (!available.length) {
      slotSelect.innerHTML = '<option value="">No available slots this day</option>';
    } else {
      slotSelect.innerHTML = `<option value="">— Choose a time —</option>` +
        available.map(s => `<option value="${s.time}">${formatTime(s.time)}</option>`).join('');
    }
    slotSelect.disabled = false;
    if (slotLoading) slotLoading.style.display = 'none';
  } catch (err) {
    slotSelect.innerHTML = '<option value="">Error loading slots</option>';
    slotSelect.disabled = false;
    if (slotLoading) slotLoading.style.display = 'none';
  }
}

function onSlotSelect(time) {
  selectedSlot = time || null;
  const cp = document.getElementById('confirm-panel');
  if (!cp) return;
  if (!selectedSlot) { cp.style.display = 'none'; return; }
  document.getElementById('confirm-time').textContent = formatDateTime(selectedSlot);
  cp.style.display = 'block';
}

// ─── CONFIRM BOOKING ───────────────────────────────────────────────────────────
async function confirmBooking() {
  if (!selectedSlot) return;

  // Show T&C modal first
  const late = Math.ceil(selectedSvc.duration_minutes * 0.25);
  document.getElementById('tc-late-mins').textContent = late;
  openModal('tc-modal');
}

async function finalizeBooking() {
  closeModal('tc-modal');
  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.textContent = 'Confirming…';

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
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Booking →'; }
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

// ─── SUCCESS + IN-APP RECEIPT ──────────────────────────────────────────────────
function showBookingSuccess() {
  const view = document.getElementById('booking-view');
  view.innerHTML = `
    <div class="container-sm" style="padding-top:32px">
      <div class="success-screen">
        <div class="success-icon">✓</div>
        <h2>Appointment Confirmed!</h2>
        <p class="mt-8">Your booking at <strong>${business.name}</strong> is locked in.</p>
        <div class="card mt-20" style="text-align:left;padding:20px">
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Booking ID</span>
            <span class="font-bold">#${booking.id}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Service</span>
            <span class="font-bold">${selectedSvc.name}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Date &amp; Time</span>
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
            <span class="badge badge-green">Confirmed ✓</span>
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn-primary" onclick="downloadReceipt()">📥 Download Receipt</button>
          <button class="btn btn-outline" onclick="window.location.reload()">Book Another</button>
        </div>
      </div>
    </div>
  `;

  // Show PWA install prompt after successful booking
  showPwaPromptIfAvailable();
}

// ─── RECEIPT DOWNLOAD ──────────────────────────────────────────────────────────
function downloadReceipt() {
  const lines = [
    '=============================',
    '       JOMISH BOOKING        ',
    '       RECEIPT               ',
    '=============================',
    `Business  : ${business.name}`,
    `Client    : ${client.name}`,
    `Booking ID: #${booking.id}`,
    `Service   : ${selectedSvc.name}`,
    `Date/Time : ${formatDateTime(booking.booking_time)}`,
    `Duration  : ${selectedSvc.duration_minutes} minutes`,
    `Price     : ${formatCurrency2(selectedSvc.price)}`,
    `Status    : Confirmed`,
    '=============================',
    `Generated : ${new Date().toLocaleString()}`,
  ].join('\n');

  const blob = new Blob([lines], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `Jomish-Receipt-${booking.id}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── SOCKET.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') return;
  socket = io();

  socket.on('slot:taken', ({ time }) => {
    // Mark slot as taken in the dropdown
    const sel = document.getElementById('slot-select');
    if (sel) {
      [...sel.options].forEach(opt => {
        if (opt.value === time) {
          opt.text += ' (taken)';
          opt.disabled = true;
        }
      });
    }
    if (selectedSlot === time) {
      selectedSlot = null;
      const cp = document.getElementById('confirm-panel');
      if (cp) cp.style.display = 'none';
      toast('Slot Taken', 'Someone just booked that slot. Please choose another.', 'error');
    }
  });
}

// ─── STANDALONE FLOATING CHAT ──────────────────────────────────────────────────
let clientChatOpen   = false;
let clientChatLoaded = false;

function toggleClientChat() {
  const modal = document.getElementById('client-chat-modal');
  if (!modal) return;
  clientChatOpen = !clientChatOpen;
  modal.style.display = clientChatOpen ? 'flex' : 'none';
  if (clientChatOpen && !clientChatLoaded) {
    loadClientChatHistory();
    clientChatLoaded = true;
    if (socket && business && client) {
      socket.emit('join:chat', { businessId: business.id, clientId: client.id });
      socket.on('chat:message', (msg) => {
        // Only render messages from seller (client's own messages already rendered)
        if (msg.sender === 'seller') renderClientChatMsg(msg);
      });
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
  const el   = document.createElement('div');
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

  // Render immediately (optimistic)
  renderClientChatMsg({ sender: 'client', content, created_at: new Date().toISOString() });
  input.value = '';

  try {
    const msg = await apiFetch('/api/messages', {
      method: 'POST',
      body: { business_id: business.id, client_id: client.id, sender: 'client', content }
    });
    // Track sent ID to avoid socket double-render
    if (msg.id) sentMsgIds.add(msg.id);
  } catch (err) {
    toast('Send failed', err.message, 'error');
  }
}

// ─── PWA INSTALL PROMPT ────────────────────────────────────────────────────────
let _pwaPromptEvent = null;

function setupPwaPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _pwaPromptEvent = e;
  });
}

function showPwaPromptIfAvailable() {
  if (!_pwaPromptEvent) return;
  // Show a nice banner
  const banner = document.createElement('div');
  banner.id = 'pwa-banner';
  banner.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:linear-gradient(135deg,#1a2461,#5b67f6); color:#fff;
    border-radius:16px; padding:16px 20px; max-width:340px; width:90%;
    box-shadow:0 8px 32px rgba(0,0,0,0.3); z-index:9999;
    display:flex; align-items:center; gap:14px; animation: slideUp 0.4s ease;
  `;
  banner.innerHTML = `
    <div style="font-size:2rem">📲</div>
    <div style="flex:1">
      <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px">Install Jomish App</div>
      <div style="font-size:0.78rem;opacity:0.85">Add to your home screen for faster bookings and notifications</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <button onclick="installPwa()" style="background:#fff;color:#1a2461;border:none;border-radius:8px;padding:6px 14px;font-size:0.82rem;font-weight:700;cursor:pointer;">Install</button>
      <button onclick="document.getElementById('pwa-banner').remove()" style="background:transparent;color:rgba(255,255,255,0.7);border:none;font-size:0.75rem;cursor:pointer;">Maybe later</button>
    </div>
  `;
  document.body.appendChild(banner);
}

async function installPwa() {
  if (!_pwaPromptEvent) return;
  _pwaPromptEvent.prompt();
  const { outcome } = await _pwaPromptEvent.userChoice;
  _pwaPromptEvent = null;
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.remove();
  if (outcome === 'accepted') toast('App Installed! 🎉', 'Jomish has been added to your home screen.', 'success');
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

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
