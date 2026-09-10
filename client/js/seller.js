/**
 * Jomish Booking System — Seller Dashboard Logic
 * Real-time orders, bookings, client notes, and in-app chat
 */

let businesses    = [];
let selectedBiz   = null;
let socket        = null;
let currentClient = null;
let currentMode   = 'orders'; // 'orders' | 'bookings'
let noteDebounce  = null;

// ─── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  document.title = 'Seller Dashboard | Jomish';
  
  if (!localStorage.getItem('auth_token')) {
    window.location.replace('/login.html');
    return;
  }

  try {
    businesses = await apiFetch('/api/businesses');
    renderBizSelector();
    initPushNotifications();
  } catch (err) {
    toast('Error', 'Could not load businesses', 'error');
  }
});

// ─── Business Selector ─────────────────────────────────────────
function renderBizSelector() {
  const sel = document.getElementById('biz-select');
  sel.innerHTML = `<option value="">-- Select Business --</option>` +
    businesses.map(b => `<option value="${b.id}" data-slug="${b.slug}" data-type="${b.type}">${b.name}</option>`).join('');
}

function onBizChange() {
  const sel   = document.getElementById('biz-select');
  const opt   = sel.options[sel.selectedIndex];
  if (!opt.value) return;
  selectedBiz = businesses.find(b => b.id === parseInt(opt.value));
  if (!selectedBiz) return;

  // Fetch full business config
  apiFetch(`/api/businesses/${selectedBiz.slug}`).then(biz => {
    selectedBiz = biz;
    document.getElementById('dashboard-title').textContent = biz.name;
    document.getElementById('dashboard-type').textContent  = biz.type === 'product' ? '🛍️ Product Business' : '📅 Service Business';
    document.getElementById('seller-content').style.display = 'grid';
    document.getElementById('no-biz').style.display = 'none';

    // Set tab based on business type
    currentMode = biz.type === 'product' ? 'orders' : 'bookings';
    updateTabs();
    loadList();
    initSocket(biz);
  });
}

function switchTab(mode) {
  currentMode = mode;
  currentClient = null;
  updateTabs();
  loadList();
  document.getElementById('detail-panel').innerHTML = `
    <div class="loading-center" style="padding:80px;color:var(--text-500)">
      <div style="font-size:2rem">👈</div>
      <p style="margin-top:12px">Select an item from the list</p>
    </div>`;
}

function updateTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });
}

// ─── List Loading ──────────────────────────────────────────────
async function loadList() {
  const listEl = document.getElementById('items-list');
  listEl.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    if (currentMode === 'orders') {
      const items = await apiFetch(`/api/orders/list/${selectedBiz.id}`);
      renderOrderList(items);
    } else {
      const today = new Date().toISOString().split('T')[0];
      const items = await apiFetch(`/api/bookings/list/${selectedBiz.id}?date=${today}`);
      renderBookingList(items);
    }
  } catch (err) {
    listEl.innerHTML = `<div class="loading-center"><p style="color:var(--red-400)">${err.message}</p></div>`;
  }
}

function renderOrderList(orders) {
  const listEl = document.getElementById('items-list');
  if (!orders.length) {
    listEl.innerHTML = `<div class="loading-center" style="color:var(--text-500)"><p>No orders yet.</p></div>`;
    return;
  }
  listEl.innerHTML = orders.map(o => `
    <div class="list-item" onclick="selectOrder(${o.id}, ${o.client_id})" id="order-${o.id}">
      <div class="list-avatar">${initials(o.client_name)}</div>
      <div class="list-info">
        <div class="list-name">${o.client_name}</div>
        <div class="list-meta">${o.product_title} ×${o.quantity}</div>
      </div>
      <div class="list-right">
        <span class="badge ${statusBadgeClass(o.status)}">${o.status}</span>
        <div class="text-xs text-dim mt-8">${timeAgo(o.created_at)}</div>
      </div>
    </div>
  `).join('');
}

function renderBookingList(bookings) {
  const listEl = document.getElementById('items-list');
  if (!bookings.length) {
    listEl.innerHTML = `<div class="loading-center" style="color:var(--text-500)"><p>No bookings today.</p></div>`;
    return;
  }
  listEl.innerHTML = bookings.map(b => `
    <div class="list-item" onclick="selectBooking(${b.id}, ${b.client_id})" id="booking-${b.id}">
      <div class="list-avatar">${initials(b.client_name)}</div>
      <div class="list-info">
        <div class="list-name">${b.client_name}</div>
        <div class="list-meta">${formatTime(b.booking_time)}</div>
      </div>
      <div class="list-right">
        <span class="badge ${statusBadgeClass(b.status)}">${b.status}</span>
      </div>
    </div>
  `).join('');
}

// ─── Select Order ──────────────────────────────────────────────
async function selectOrder(orderId, clientId) {
  highlightItem(`order-${orderId}`);
  await loadClientDetail(clientId, {
    type: 'order',
    id: orderId,
  });
}

async function selectBooking(bookingId, clientId) {
  highlightItem(`booking-${bookingId}`);
  await loadClientDetail(clientId, {
    type: 'booking',
    id: bookingId,
  });
}

function highlightItem(id) {
  document.querySelectorAll('.list-item').forEach(el => el.classList.remove('selected'));
  document.getElementById(id)?.classList.add('selected');
}

// ─── Client Detail Panel ───────────────────────────────────────
async function loadClientDetail(clientId, context) {
  currentClient = clientId;
  const panel = document.getElementById('detail-panel');
  panel.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    const client = await apiFetch(`/api/clients/${clientId}`);
    renderDetailPanel(client, context);
  } catch (err) {
    panel.innerHTML = `<div class="loading-center"><p style="color:var(--red-400)">${err.message}</p></div>`;
  }
}

function renderDetailPanel(client, context) {
  const panel = document.getElementById('detail-panel');
  const avatarHtml = client.photo_url
    ? `<img src="${client.photo_url}" alt="${client.name}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">`
    : `<div class="list-avatar" style="width:56px;height:56px;font-size:1.3rem">${initials(client.name)}</div>`;

  panel.innerHTML = `
    <div class="card detail-card">
      <div class="flex gap-12 items-center mb-16">
        ${avatarHtml}
        <div>
          <h2 style="font-size:1.15rem">${client.name}</h2>
          <p class="text-sm text-dim">📍 ${client.location}</p>
          <p class="text-xs text-dim">Client since ${formatDate(client.created_at)}</p>
        </div>
      </div>
      <hr class="divider">
      <div class="detail-section">
        <h3>Actions</h3>
        <div class="status-row" id="status-row-${context.type}-${context.id}">
          <button class="status-chip pending"   onclick="updateStatus('${context.type}', ${context.id}, 'pending')">Pending</button>
          <button class="status-chip completed" onclick="updateStatus('${context.type}', ${context.id}, 'completed')">Completed</button>
          <button class="status-chip cancelled" onclick="updateStatus('${context.type}', ${context.id}, 'cancelled')">Cancelled</button>
        </div>
      </div>
      <hr class="divider">
      <div class="detail-section">
        <h3>Seller Note</h3>
        <textarea id="seller-note" placeholder="Internal note about this client…" onblur="saveNote(${client.id})" oninput="scheduleNoteSave(${client.id})">${client.seller_note || ''}</textarea>
        <p class="text-xs text-dim mt-8" id="note-status">Auto-saves when you stop typing</p>
      </div>
      <hr class="divider">
      <div class="detail-section">
        <h3>Chat</h3>
        <div class="chat-panel">
          <div class="chat-header">💬 ${client.name}</div>
          <div class="chat-messages" id="chat-msgs"></div>
          <div class="chat-input-row">
            <input type="text" id="seller-chat-input" placeholder="Reply…" onkeydown="if(event.key==='Enter') sellerSendMsg(${client.id})">
            <button onclick="sellerSendMsg(${client.id})">Send</button>
          </div>
        </div>
      </div>
    </div>
  `;

  loadChatHistory(client.id);
}

// ─── Status Update ─────────────────────────────────────────────
async function updateStatus(type, id, status) {
  try {
    const endpoint = type === 'order'
      ? `/api/orders/${id}/status`
      : `/api/bookings/${id}/status`;

    await apiFetch(endpoint, {
      method: 'PATCH',
      body: { status }
    });
    toast('Updated', `Status changed to ${status}`, 'success', 2000);

    // Update badge in list
    const listItem = document.getElementById(`${type}-${id}`);
    const badge = listItem?.querySelector('.badge');
    if (badge) {
      badge.className = `badge ${statusBadgeClass(status)}`;
      badge.textContent = status;
    }
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

// ─── Seller Note Auto-save ─────────────────────────────────────
function scheduleNoteSave(clientId) {
  clearTimeout(noteDebounce);
  document.getElementById('note-status').textContent = 'Typing…';
  noteDebounce = setTimeout(() => saveNote(clientId), 800);
}

async function saveNote(clientId) {
  const note = document.getElementById('seller-note')?.value || '';
  try {
    await apiFetch(`/api/clients/${clientId}/note`, {
      method: 'PATCH',
      body: { note }
    });
    document.getElementById('note-status').textContent = '✓ Saved';
  } catch (err) {
    document.getElementById('note-status').textContent = '⚠ Save failed';
  }
}

// ─── Seller Chat ───────────────────────────────────────────────
async function loadChatHistory(clientId) {
  try {
    const msgs = await apiFetch(`/api/messages/${selectedBiz.id}/${clientId}`);
    msgs.forEach(renderMsg);
    scrollChat();
  } catch { /* no history */ }

  if (socket) {
    socket.emit('join:chat', { businessId: selectedBiz.id, clientId });
  }
}

function renderMsg(msg) {
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `msg-bubble ${msg.sender}`;
  el.innerHTML = `${msg.content}<div class="msg-time">${formatTime(msg.created_at)}</div>`;
  box.appendChild(el);
}

function scrollChat() {
  const box = document.getElementById('chat-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

async function sellerSendMsg(clientId) {
  const input   = document.getElementById('seller-chat-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  try {
    await apiFetch('/api/messages', {
      method: 'POST',
      body: { business_id: selectedBiz.id, client_id: clientId, sender: 'seller', content }
    });
  } catch (err) {
    toast('Send failed', err.message, 'error');
  }
}

// ─── Socket.io — Real-time Seller Notifications ───────────────
function initSocket(biz) {
  if (typeof io === 'undefined') return;
  if (socket) socket.disconnect();
  socket = io();

  // Join seller room (receives Pusher-mirrored events)
  socket.emit('join:seller', { channel: biz.pusher_channel || `biz-${biz.id}` });

  // New order notification
  socket.on('order:waiting', (data) => {
    showNewOrderAlert(data);
    loadList(); // Refresh list
  });

  // New booking notification
  socket.on('booking:new', (data) => {
    showNewBookingAlert(data);
    loadList();
  });

  // Incoming chat message from client
  socket.on('chat:message', (msg) => {
    if (msg.sender === 'client') {
      renderMsg(msg);
      scrollChat();
    }
  });
}

// ─── New Order Alert ───────────────────────────────────────────
function showNewOrderAlert(data) {
  toast(
    `🔔 New Order — ${data.clientName}`,
    `${data.productTitle} — Client is waiting!`,
    'info',
    8000
  );
  // Pulse the header
  document.getElementById('dashboard-title')?.classList.add('pulse');
  setTimeout(() => document.getElementById('dashboard-title')?.classList.remove('pulse'), 5000);
}

function showNewBookingAlert(data) {
  toast(
    `📅 New Booking — ${data.clientName}`,
    `Booked for ${formatDateTime(data.bookingTime)}`,
    'info',
    6000
  );
}

// ─── Helpers ───────────────────────────────────────────────────
function statusBadgeClass(status) {
  if (status === 'pending')   return 'badge-gold';
  if (status === 'completed') return 'badge-green';
  if (status === 'cancelled') return 'badge-red';
  if (status === 'confirmed') return 'badge-blue';
  return 'badge-gold';
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Web Push Notifications ──────────────────────────────────────
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      // Fetch VAPID key
      const vapidPublicKey = await fetch('/api/push/vapidPublicKey').then(r => r.text());
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
      
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }

    // Send to server
    await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: subscription
    });
  } catch (err) {
    console.error('Push registration failed:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
