/**
 * Jomish — Service Booking Page Logic
 * Flow: Register → Pick Services (multi-select cart) → Pick Day → Pick Slot → Confirm → Receipt
 */

let business     = null;
let client       = null;
let socket       = null;
let selectedDate = null;
let selectedSlot = null;
let booking      = null;
const sentMsgIds = new Set();

// ─── SERVICE CART ──────────────────────────────────────────────────────────────
let serviceCart  = {};   // { id: serviceObj }
let allServices  = [];

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
    document.getElementById('biz-sub').textContent  = 'Place an Order';

    if (business.phone_number) {
      const callBtn = document.getElementById('call-btn');
      if (callBtn) { callBtn.href = `tel:${business.phone_number}`; callBtn.style.display = 'flex'; }
    }

    const chatTitle = document.getElementById('client-chat-title');
    if (chatTitle) chatTitle.textContent = `Chat with ${business.name}`;

    showRegistrationModal((c) => {
      client = c;
      loadAndShowServices();
      initSocket();
      const floatBtn = document.getElementById('float-chat-btn');
      if (floatBtn) floatBtn.style.display = 'flex';

      // Register for push notifications so seller can notify client
      registerClientPush(c.id);

      if (socket && socket.connected) {
        socket.emit('join:chat', { businessId: business.id, clientId: c.id });
      }
    });
  } catch (err) {
    renderError('Business not found. Check your link and try again.');
  }
});

// ─── STEP 1: PICK SERVICES (MULTI-SELECT CART) ─────────────────────────────────
async function loadAndShowServices() {
  const view = document.getElementById('booking-view');
  view.innerHTML = `<div class="loading-center"><div class="spinner"></div><p>Loading services...</p></div>`;

  try {
    allServices = await apiFetch(`/api/services/${business.slug}`);

    if (!allServices.length) {
      view.innerHTML = `
        <div class="container-sm" style="padding-top:32px">
          <div class="card" style="text-align:center;padding:48px">
            <h2>No Services Yet</h2>
            <p class="mt-8 text-dim">This business hasn't added any services yet. Check back soon!</p>
          </div>
        </div>`;
      return;
    }

    renderServicesView();
  } catch (err) {
    renderError('Could not load services: ' + err.message);
  }
}

function renderServicesView() {
  const view = document.getElementById('booking-view');
  const cartCount = Object.keys(serviceCart).length;
  const cartTotal = Object.values(serviceCart).reduce((s, sv) => s + parseFloat(sv.price), 0);
  const cartDuration = Object.values(serviceCart).reduce((s, sv) => s + parseInt(sv.duration_minutes), 0);

  view.innerHTML = `
    <div class="container-sm" style="padding-top:24px">
      <div class="card" style="padding:24px">
        <h3 style="margin-bottom:4px">1. Choose Services</h3>
        <p class="text-dim text-sm mb-16">at ${business.name} — select one or more</p>
        <div id="service-list">
          ${allServices.map(s => {
            const inCart = !!serviceCart[s.id];
            return `
            <div class="service-card ${inCart ? 'service-card-selected' : ''}" 
                 id="svc-card-${s.id}"
                 onclick="toggleServiceCart(${JSON.stringify(s).replace(/"/g,'&quot;')})"
                 style="cursor:pointer; transition: all 0.2s;">
              <div class="service-card-info">
                <div class="service-card-name">${s.name}</div>
                <div class="service-card-meta">${s.duration_minutes} min</div>
              </div>
              <div style="display:flex;align-items:center;gap:12px">
                <div class="service-card-price">${formatCurrency2(s.price)}</div>
                <div class="svc-check-box" id="svc-check-${s.id}" style="
                  width:24px;height:24px;border-radius:50%;border:2px solid ${inCart ? '#22c55e' : '#cbd5e1'};
                  display:flex;align-items:center;justify-content:center;
                  background:${inCart ? '#22c55e' : 'transparent'};
                  color:#fff;font-size:0.85rem;font-weight:bold;flex-shrink:0;
                ">${inCart ? '✓' : ''}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      ${cartCount > 0 ? `
      <!-- Cart Summary -->
      <div class="card mt-16" style="padding:20px; border:2px solid #22c55e;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">${cartCount} Service${cartCount > 1 ? 's' : ''} Selected</h3>
          <span class="badge badge-green">Cart</span>
        </div>
        ${Object.values(serviceCart).map(sv => `
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:6px">
            <span>${sv.name}</span>
            <span class="font-bold">${formatCurrency2(sv.price)}</span>
          </div>
        `).join('')}
        <hr style="margin:12px 0;border-color:#e2e8f0">
        <div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:4px">
          <span class="text-dim">Total Duration</span>
          <span class="font-bold">${cartDuration} min</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:16px">
          <span class="text-dim">Total Price</span>
          <span class="font-bold">${formatCurrency2(cartTotal)}</span>
        </div>
        <button class="btn btn-primary btn-full" onclick="goToDateStep()">
          Pick a Time Slot →
        </button>
      </div>` : `
      <div class="card mt-16" style="padding:16px;text-align:center;border:1px dashed #cbd5e1">
        <p class="text-dim text-sm">Select one or more services above to continue</p>
      </div>
      `}
    </div>
  `;
}

function toggleServiceCart(svcObj) {
  const svc = typeof svcObj === 'string' ? JSON.parse(svcObj) : svcObj;
  if (serviceCart[svc.id]) {
    delete serviceCart[svc.id];
  } else {
    serviceCart[svc.id] = svc;
  }
  renderServicesView();
}

// ─── STEP 2: PICK DATE → PICK SLOT ────────────────────────────────────────────
function goToDateStep() {
  if (!Object.keys(serviceCart).length) return;
  selectedDate = null;
  selectedSlot = null;
  showDateSlotStep();
}

function showDateSlotStep() {
  const totalDuration = Object.values(serviceCart).reduce((s, sv) => s + parseInt(sv.duration_minutes), 0);
  const totalPrice    = Object.values(serviceCart).reduce((s, sv) => s + parseFloat(sv.price), 0);
  const serviceCount  = Object.keys(serviceCart).length;
  const serviceNames  = Object.values(serviceCart).map(s => s.name).join(', ');

  const days = [];
  const now  = new Date();
  const dayNames    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
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

      <!-- Cart Summary pill -->
      <div class="card mb-16" style="padding:14px 18px;">
        <div style="font-weight:700;margin-bottom:6px">${serviceCount} Service${serviceCount > 1 ? 's' : ''}</div>
        <div class="text-dim text-sm" style="margin-bottom:4px">${serviceNames}</div>
        <div style="display:flex;gap:16px;font-size:0.85rem">
          <span class="badge badge-blue">${totalDuration} min total</span>
          <span class="font-bold">${formatCurrency2(totalPrice)}</span>
        </div>
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
          <div id="slot-loading" style="display:none" class="text-dim text-sm mt-8">Loading available slots...</div>
        </div>
      </div>

      <div class="card mt-16" id="confirm-panel" style="display:none;padding:24px">
        <h3 style="margin-bottom:16px">4. Confirm Order</h3>
        ${Object.values(serviceCart).map(sv => `
          <div class="flex justify-between items-center mb-8 text-sm">
            <span class="text-dim">${sv.name}</span>
            <span class="font-bold">${formatCurrency2(sv.price)}</span>
          </div>
        `).join('')}
        <hr style="margin:12px 0;border-color:#e2e8f0">
        <div class="flex justify-between items-center mb-8 text-sm">
          <span class="text-dim">Total Duration</span>
          <span class="font-bold">${totalDuration} min</span>
        </div>
        <div class="flex justify-between items-center mb-8 text-sm">
          <span class="text-dim">Total Price</span>
          <span class="font-bold">${formatCurrency2(totalPrice)}</span>
        </div>
        <div class="flex justify-between items-center mb-20 text-sm">
          <span class="text-dim">Time</span>
          <span class="font-bold" id="confirm-time"></span>
        </div>
        <button class="btn btn-primary btn-full" id="confirm-btn" onclick="confirmBooking()">Confirm Order →</button>
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
  slotSelect.innerHTML = '<option value="">Loading...</option>';
  slotSelect.disabled = true;
  if (slotLoading) slotLoading.style.display = 'block';
  if (confirmPanel) confirmPanel.style.display = 'none';

  // Use total duration for slot availability
  const totalDuration = Object.values(serviceCart).reduce((s, sv) => s + parseInt(sv.duration_minutes), 0);
  const primarySvcId  = Object.values(serviceCart)[0]?.id || '';

  if (socket) socket.emit('join:slots', { businessId: business.id, date: selectedDate });

  try {
    const data = await apiFetch(`/api/slots/${business.slug}?date=${dateString}&service_id=${primarySvcId}&duration=${totalDuration}`);
    const now = new Date();

    const available = (data.slots || []).filter(s => {
      if (!s.available) return false;
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

  // T&C modal — use total duration to compute late threshold
  const totalDuration = Object.values(serviceCart).reduce((s, sv) => s + parseInt(sv.duration_minutes), 0);
  const late = Math.ceil(totalDuration * 0.25);
  document.getElementById('tc-late-mins').textContent = late;
  openModal('tc-modal');
}

async function finalizeBooking() {
  closeModal('tc-modal');
  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.textContent = 'Confirming...';

  const serviceIdsArray = Object.values(serviceCart).map(sv => sv.id);

  try {
    booking = await apiFetch('/api/bookings', {
      method: 'POST',
      body: {
        business_id:  business.id,
        client_id:    client.id,
        booking_time: selectedSlot,
        service_ids:  serviceIdsArray,
      }
    });

    await notifySeller();
    if (socket) socket.emit('slot:booked', { businessId: business.id, date: selectedDate, time: selectedSlot });

    showBookingSuccess();
  } catch (err) {
    toast('Order Failed', err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Order →'; }
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

// ─── SUCCESS + RECEIPT ─────────────────────────────────────────────────────────
function showBookingSuccess() {
  const totalPrice    = Object.values(serviceCart).reduce((s, sv) => s + parseFloat(sv.price), 0);
  const totalDuration = Object.values(serviceCart).reduce((s, sv) => s + parseInt(sv.duration_minutes), 0);
  const serviceCount  = Object.keys(serviceCart).length;

  const view = document.getElementById('booking-view');
  view.innerHTML = `
    <div class="container-sm" style="padding-top:32px">
      <div class="success-screen">
        <div class="success-icon">✓</div>
        <h2>Appointment Confirmed!</h2>
        <p class="mt-8">Your booking at <strong>${business.name}</strong> is locked in.</p>
        <div class="card mt-20" style="text-align:left;padding:20px">
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Order ID</span>
            <span class="font-bold">#${booking.id}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">${serviceCount > 1 ? 'Services' : 'Service'}</span>
            <span class="font-bold">${Object.values(serviceCart).map(sv => sv.name).join(', ')}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Date &amp; Time</span>
            <span class="font-bold">${formatDateTime(booking.booking_time)}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Total Duration</span>
            <span class="font-bold">${totalDuration} min</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Total Price</span>
            <span class="font-bold">${formatCurrency2(totalPrice)}</span>
          </div>
          <div class="flex justify-between mt-8 text-sm">
            <span class="text-dim">Status</span>
            <span class="badge badge-green">Confirmed ✓</span>
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn-primary" onclick="downloadBookingReceipt()">Download Invoice</button>
          <button class="btn btn-outline" onclick="window.location.reload()">Book Another</button>
        </div>
      </div>
    </div>
  `;

  showPwaPromptIfAvailable();
}

// ─── INVOICE DOWNLOAD ─────────────────────────────────────────────────────────
function downloadBookingReceipt() {
  const sym          = business?.currency_symbol || '$';
  const totalPrice   = Object.values(serviceCart).reduce((s, sv) => s + parseFloat(sv.price), 0);
  const totalDuration= Object.values(serviceCart).reduce((s, sv) => s + parseInt(sv.duration_minutes), 0);
  const serviceList  = Object.values(serviceCart);

  const element = document.createElement('div');
  element.style.padding = '30px';
  element.style.fontFamily = 'Arial, sans-serif';
  element.style.color = '#000';

  element.innerHTML = `
    <h1 style="font-size:24px;font-weight:bold;margin-bottom:5px">${business.name}</h1>
    <h2 style="font-size:18px;color:#555;margin-bottom:20px">Booking Invoice</h2>
    <p style="font-size:14px;margin-bottom:5px"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
    <p style="font-size:14px;margin-bottom:5px"><strong>Client:</strong> ${client.name}</p>
    <p style="font-size:14px;margin-bottom:5px"><strong>Appointment:</strong> ${formatDateTime(booking.booking_time)}</p>
    <p style="font-size:14px;margin-bottom:20px"><strong>Status:</strong> Confirmed</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead>
        <tr style="border-bottom:2px solid #000">
          <th style="text-align:left;padding:8px 0">Service</th>
          <th style="text-align:center;padding:8px 0">Duration</th>
          <th style="text-align:right;padding:8px 0">Price</th>
        </tr>
      </thead>
      <tbody>
        ${serviceList.map(sv => `
          <tr style="border-bottom:1px solid #ccc">
            <td style="padding:8px 0">${sv.name}</td>
            <td style="text-align:center;padding:8px 0">${sv.duration_minutes} min</td>
            <td style="text-align:right;padding:8px 0">${sym}${parseFloat(sv.price).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="text-align:right;font-weight:bold;padding:12px 0">Total (${totalDuration} min):</td>
          <td style="text-align:right;font-weight:bold;padding:12px 0;font-size:18px">${sym}${totalPrice.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="text-align:center;margin-top:40px;font-size:12px;color:#777">
      <p>Powered by Jomish Tech Hub</p>
    </div>
  `;

  if (typeof html2pdf !== 'undefined') {
    html2pdf().set({
      margin: 0.5,
      filename: `booking_invoice_${booking.id}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    }).from(element).save().then(() => {
      toast('Downloaded!', 'Booking invoice saved.', 'success');
    });
  } else {
    // Fallback: plain text
    const lines = [
      `${business.name} — Booking Invoice`,
      `Date: ${new Date().toLocaleString()}`,
      `Client: ${client.name}`,
      `Appointment: ${formatDateTime(booking.booking_time)}`,
      '---',
      ...Object.values(serviceCart).map(sv => `${sv.name} — ${sv.duration_minutes}min — ${sym}${parseFloat(sv.price).toFixed(2)}`),
      '---',
      `Total Duration: ${totalDuration} min`,
      `Total Price: ${sym}${totalPrice.toFixed(2)}`,
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `booking_invoice_${booking.id}.txt`; a.click();
    URL.revokeObjectURL(url);
  }
}

// ─── SOCKET.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') return;
  socket = io();

  // Join chat room on connect so server can route events back to this client
  socket.on('connect', () => {
    if (business && client) {
      socket.emit('join:chat', { businessId: business.id, clientId: client.id });
    }
  });
  if (socket.connected && business && client) {
    socket.emit('join:chat', { businessId: business.id, clientId: client.id });
  }

  socket.on('slot:taken', ({ time }) => {
    const sel = document.getElementById('slot-select');
    if (sel) {
      [...sel.options].forEach(opt => {
        if (opt.value === time) { opt.text += ' (taken)'; opt.disabled = true; }
      });
    }
    if (selectedSlot === time) {
      selectedSlot = null;
      const cp = document.getElementById('confirm-panel');
      if (cp) cp.style.display = 'none';
      toast('Slot Taken', 'Someone just booked that slot. Please choose another.', 'error');
    }
  });

  // Seller marked booking complete — auto-download invoice on client side
  socket.on('booking:completed', ({ bookingId, bizSlug }) => {
    toast('Service Complete', 'Your invoice is ready. Downloading now...', 'success');
    setTimeout(() => triggerBookingReceiptDownload(bookingId, bizSlug || (business && business.slug)), 800);
  });

  // Seller cancelled booking — show reason
  socket.on('booking:cancelled', ({ reason }) => {
    const msg = reason
      ? `Your booking was cancelled. Reason: ${reason}`
      : 'Your booking was cancelled by the seller.';
    toast('Booking Cancelled', msg, 'error');
  });
}

// Register this client device for web push notifications
async function registerClientPush(clientId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const vapidKey = await fetch('/api/push/vapidPublicKey').then(r => r.text());
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    }
    await fetch('/api/push/subscribe-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, client_id: clientId })
    });
  } catch (err) { console.error('[push] Client push registration failed:', err); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}

// Service worker postMessage — fired when user taps a push notification
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'download-receipt') {
      const urlParams = new URLSearchParams(new URL(event.data.url, window.location.origin).search);
      const bId = urlParams.get('booking_id');
      if (bId) triggerBookingReceiptDownload(bId, business ? business.slug : null);
    } else if (event.data.type === 'cancelled') {
      toast('Booking Cancelled', 'Your booking was cancelled by the seller.', 'error');
    }
  });
}

async function triggerBookingReceiptDownload(bookingId, bizSlug) {
  try {
    const services = Object.values(serviceCart);
    const svcNames = services.length ? services.map(s => s.name).join(', ') : ((booking && booking.service_name) || 'Service');
    const total = services.reduce((sum, s) => sum + parseFloat(s.price || 0), 0) || parseFloat((booking && (booking.total_price || booking.price)) || 0);
    if (typeof html2pdf !== 'undefined') {
      html2pdf().set({
        margin: 0.5,
        filename: `invoice_booking_${bookingId}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter' }
      }).from(buildReceiptElement(svcNames, total, bookingId)).save();
    } else {
      toast('Invoice', 'PDF library not loaded yet. Please try again.', 'error');
    }
  } catch (err) {
    toast('Error', 'Could not download invoice.', 'error');
  }
}

function buildReceiptElement(svcNames, total, bookingId) {
  const el = document.createElement('div');
  el.style.cssText = 'padding:30px; font-family:Arial,sans-serif; color:#000; width:100%;';
  const bizName = (business && business.name) || 'Business';
  const clientName = (client && client.name) || 'Client';
  const sym = (business && business.currency_symbol) || '$';
  el.innerHTML = `
    <h1 style="font-size:22px;margin-bottom:4px">${bizName}</h1>
    <h2 style="font-size:15px;color:#555;margin-bottom:16px">Service Invoice</h2>
    <p style="font-size:13px;margin:4px 0"><strong>Ref:</strong> BK-${String(bookingId).padStart(5,'0')}</p>
    <p style="font-size:13px;margin:4px 0"><strong>Client:</strong> ${clientName}</p>
    <p style="font-size:13px;margin:4px 0"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
    <hr style="margin:16px 0">
    <p style="font-size:14px;margin:8px 0">${svcNames}</p>
    <hr style="margin:16px 0">
    <p style="font-size:18px;font-weight:bold">Total: ${sym}${parseFloat(total).toFixed(2)}</p>
    <p style="font-size:12px;color:#777;margin-top:30px;text-align:center">Thank you for choosing ${bizName}. Powered by Jomish.</p>
  `;
  return el;
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

  renderClientChatMsg({ sender: 'client', content, created_at: new Date().toISOString() });
  input.value = '';

  try {
    const msg = await apiFetch('/api/messages', {
      method: 'POST',
      body: { business_id: business.id, client_id: client.id, sender: 'client', content }
    });
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
    setTimeout(() => showPwaPromptIfAvailable(), 2000);
  });
}

function showPwaPromptIfAvailable() {
  if (!_pwaPromptEvent) return;
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
    <div style="font-size:2rem">+</div>
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
  if (outcome === 'accepted') toast('App Installed!', 'Jomish has been added to your home screen.', 'success');
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function todayStr()  { return dateStr(new Date()); }
function dateStr(d)  { return d.toISOString().split('T')[0]; }

function formatCurrency2(amount) {
  const sym = business?.currency_symbol || '$';
  return `${sym}${parseFloat(amount).toFixed(2)}`;
}

function renderError(msg) {
  document.getElementById('booking-view').innerHTML = `
    <div class="loading-center" style="padding:80px">
      <h2 style="margin-top:12px">Something went wrong</h2>
      <p>${msg}</p>
    </div>`;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
}
