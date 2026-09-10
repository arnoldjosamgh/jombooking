/**
 * Jomish — Seller Dashboard Logic
 * Handles: POS (product businesses), Calendar (service businesses),
 * First-login onboarding, QR code, barcode scanner, socket.io
 */

let selectedBiz = null;
let businesses  = [];
let socket      = null;
let posCart     = {}; // { product_id: { ...product, qty } }
let posProducts = [];
let scannerActive = false;
let currentWeekStart = null;
let codeReader = null;

// ─── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('auth_token')) {
    window.location.replace('/login.html');
    return;
  }

  const role = localStorage.getItem('role');
  const slug = localStorage.getItem('business_slug');

  try {
    if (role === 'tech') {
      businesses = await apiFetch('/api/businesses');
      const sel = document.getElementById('biz-select');
      sel.style.display = 'block';
      sel.innerHTML = '<option value="">-- Select Business --</option>' +
        businesses.map(b => `<option value="${b.slug}" data-type="${b.type}">${b.name}</option>`).join('');
    } else if (slug) {
      const biz = await apiFetch(`/api/businesses/${slug}`);
      setupBiz(biz);
    } else {
      document.getElementById('no-biz').innerHTML = `
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>No business linked to your account. Contact tech support.</p>
      `;
    }
    initPushNotifications();
  } catch (err) {
    toast('Error', 'Could not load business data: ' + err.message, 'error');
  }
});

function onBizChange() {
  const sel = document.getElementById('biz-select');
  const slug = sel.value;
  if (!slug) return;
  apiFetch(`/api/businesses/${slug}`).then(biz => setupBiz(biz)).catch(e => toast('Error', e.message, 'error'));
}

// ─── BIZ SETUP ─────────────────────────────────────────────────────────────────
function setupBiz(biz) {
  selectedBiz = biz;
  document.getElementById('no-biz').style.display = 'none';
  document.getElementById('seller-content').style.display = 'block';
  document.getElementById('dashboard-title').textContent = biz.name;

  const type = biz.type;
  document.getElementById('dashboard-type').textContent = type === 'product' ? '🛍️ Point of Sale' : '📅 Service Calendar';

  if (type === 'product' || type === 'both') {
    renderPOS();
  } else {
    renderCalendar();
  }

  initSocket(biz);
  checkFirstLogin(biz);
}

// ─── FIRST LOGIN ONBOARDING ────────────────────────────────────────────────────
function checkFirstLogin(biz) {
  const key = 'first_login_' + biz.slug;
  if (localStorage.getItem(key)) {
    showOnboarding(biz);
    localStorage.removeItem(key);
  }
}

function showOnboarding(biz) {
  biz = biz || selectedBiz;
  if (!biz) return;
  const clientLink = `${window.location.origin}/c/${biz.slug}`;
  document.getElementById('ob-client-link').value = clientLink;

  const qrEl = document.getElementById('ob-qrcode');
  qrEl.innerHTML = '';
  new QRCode(qrEl, { text: clientLink, width: 180, height: 180, colorDark: '#1a2461', colorLight: '#ffffff' });

  const modal = document.getElementById('onboarding-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  modal.classList.remove('active');
  setTimeout(() => modal.style.display = 'none', 200);
}

function copyObLink() {
  const val = document.getElementById('ob-client-link').value;
  navigator.clipboard.writeText(val).then(() => toast('Copied!', 'Client link copied to clipboard', 'success'));
}

// ─── POS SYSTEM ────────────────────────────────────────────────────────────────
async function renderPOS() {
  const main = document.getElementById('seller-content');
  const tpl = document.getElementById('tpl-pos');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));

  // Re-bind form submit
  document.getElementById('add-product-form').addEventListener('submit', addProduct);

  await loadProducts();
}

async function loadProducts() {
  try {
    posProducts = await apiFetch(`/api/products/${selectedBiz.slug}`);
    renderProductGrid();
  } catch (err) {
    toast('Error', 'Could not load products', 'error');
  }
}

function renderProductGrid() {
  const grid = document.getElementById('pos-product-grid');
  if (!grid) return;
  if (!posProducts.length) {
    grid.innerHTML = `<div class="pos-empty">No products yet. Click <strong>+ Add Product</strong> to start.</div>`;
    return;
  }
  grid.innerHTML = posProducts.map(p => `
    <div class="pos-product-card" onclick="addToCart(${p.id})">
      <div class="pos-product-name">${p.title}</div>
      <div class="pos-product-price">${formatCurrency(p.price)}</div>
      <div class="pos-product-stock ${p.stock_quantity <= 0 ? 'text-red' : ''}">${p.stock_quantity <= 0 ? '❌ Out of Stock' : `${p.stock_quantity} in stock`}</div>
    </div>
  `).join('');
}

function addToCart(productId) {
  const product = posProducts.find(p => p.id === productId);
  if (!product) return;
  if (product.stock_quantity <= 0) { toast('Out of Stock', product.title + ' has no stock', 'error'); return; }
  if (posCart[productId]) {
    if (posCart[productId].qty >= product.stock_quantity) { toast('Max Stock', 'No more stock available', 'error'); return; }
    posCart[productId].qty++;
  } else {
    posCart[productId] = { ...product, qty: 1 };
  }
  renderCart();
}

function removeFromCart(productId) {
  if (posCart[productId]) {
    posCart[productId].qty--;
    if (posCart[productId].qty <= 0) delete posCart[productId];
  }
  renderCart();
}

function renderCart() {
  const cartEl = document.getElementById('pos-cart-items');
  const totalEl = document.getElementById('pos-total-amount');
  const checkoutBtn = document.getElementById('pos-checkout-btn');
  if (!cartEl) return;

  const items = Object.values(posCart);
  if (!items.length) {
    cartEl.innerHTML = `<div class="text-dim text-center mt-24">Cart is empty</div>`;
    totalEl.textContent = formatCurrency(0);
    checkoutBtn.disabled = true;
    return;
  }

  let total = 0;
  cartEl.innerHTML = items.map(item => {
    const subtotal = item.price * item.qty;
    total += subtotal;
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.title}</div>
          <div class="cart-item-price">${formatCurrency(item.price)} each</div>
        </div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="removeFromCart(${item.id})">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="addToCart(${item.id})">+</button>
        </div>
        <div class="cart-item-subtotal">${formatCurrency(subtotal)}</div>
      </div>
    `;
  }).join('');

  totalEl.textContent = formatCurrency(total);
  checkoutBtn.disabled = false;
}

async function checkoutPos() {
  const items = Object.values(posCart).map(item => ({ product_id: item.id, qty: item.qty }));
  if (!items.length) return;

  const customerName = prompt('Customer name (optional):') || 'Walk-in Customer';

  try {
    const result = await apiFetch('/api/orders/pos-checkout', {
      method: 'POST',
      body: { business_id: selectedBiz.id, items, customer_name: customerName }
    });

    // Show receipt
    const lines = result.items.map(i => `${i.product} x${i.qty} = ${formatCurrency(i.price * i.qty)}`).join('\n');
    alert(`✅ Sale Complete!\n\n${lines}\n\nTotal: ${formatCurrency(result.total)}\nThank you!`);

    posCart = {};
    renderCart();
    await loadProducts(); // refresh stock
  } catch (err) {
    toast('Checkout Failed', err.message, 'error');
  }
}

// ─── BARCODE SCANNER ───────────────────────────────────────────────────────────
async function startBarcodeScanner() {
  if (scannerActive) return;
  if (!window.ZXingBrowser) { toast('Error', 'Scanner library not loaded', 'error'); return; }

  const container = document.getElementById('scanner-container');
  const video = document.getElementById('video');
  container.style.display = 'block';

  try {
    const hints = new Map();
    codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    scannerActive = true;

    const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
    const deviceId = devices[0]?.deviceId;

    codeReader.decodeFromVideoDevice(deviceId, video, async (result, err) => {
      if (result && scannerActive) {
        const code = result.getText();
        stopBarcodeScanner();

        // Look up product by barcode
        try {
          const product = await apiFetch(`/api/products/barcode/${encodeURIComponent(code)}`);
          addToCart(product.id);
          toast('Scanned!', `Added ${product.title} to cart`, 'success');
          // Merge scanned product into posProducts if not already there
          if (!posProducts.find(p => p.id === product.id)) {
            posProducts.push(product);
          }
        } catch (e) {
          toast('Not Found', `No product with barcode ${code}`, 'error');
        }
      }
    });
  } catch (err) {
    toast('Camera Error', 'Cannot access camera: ' + err.message, 'error');
    stopBarcodeScanner();
  }
}

function stopBarcodeScanner() {
  scannerActive = false;
  if (codeReader) { try { codeReader.reset(); } catch(e) {} codeReader = null; }
  const c = document.getElementById('scanner-container');
  if (c) c.style.display = 'none';
}

// ─── ADD PRODUCT ───────────────────────────────────────────────────────────────
function openAddProductModal() {
  const m = document.getElementById('add-product-modal');
  m.style.display = 'flex';
  setTimeout(() => m.classList.add('active'), 10);
}

async function addProduct(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Adding...';
  try {
    const product = await apiFetch('/api/products/manage', {
      method: 'POST',
      body: {
        business_id: selectedBiz.id,
        title: document.getElementById('ap-name').value,
        price: document.getElementById('ap-price').value,
        barcode: document.getElementById('ap-barcode').value,
        stock_quantity: document.getElementById('ap-stock').value
      }
    });
    posProducts.push(product);
    renderProductGrid();
    closeModal('add-product-modal');
    e.target.reset();
    toast('Added!', product.title + ' added to inventory', 'success');
  } catch (err) {
    toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Add Product';
  }
}

// ─── SERVICE CALENDAR ──────────────────────────────────────────────────────────
function renderCalendar() {
  const main = document.getElementById('seller-content');
  const tpl = document.getElementById('tpl-calendar');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));

  currentWeekStart = getMonday(new Date());
  loadWeek();
}

function getMonday(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m = new Date(d);
  m.setDate(diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function prevWeek() { currentWeekStart.setDate(currentWeekStart.getDate() - 7); loadWeek(); }
function nextWeek() { currentWeekStart.setDate(currentWeekStart.getDate() + 7); loadWeek(); }

async function loadWeek() {
  const label = document.getElementById('calendar-week-label');
  const grid = document.getElementById('calendar-grid');
  if (!label || !grid) return;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const endDate = days[6];
  label.textContent = `${days[0].toLocaleDateString('en-GB', { day:'2-digit', month:'short' })} – ${endDate.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`;

  grid.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  // Fetch bookings for the whole week
  const startStr = days[0].toISOString().split('T')[0];
  const endStr   = days[6].toISOString().split('T')[0];

  try {
    // Fetch slots and bookings for each day in parallel
    const slotPromises = days.map(d => {
      const dateStr = d.toISOString().split('T')[0];
      return apiFetch(`/api/slots/${selectedBiz.slug}?date=${dateStr}`).catch(() => ({ date: dateStr, slots: [] }));
    });
    const weekData = await Promise.all(slotPromises);

    grid.innerHTML = '';
    weekData.forEach(dayData => {
      const dayCol = document.createElement('div');
      dayCol.className = 'cal-day-col';

      const dateObj = new Date(dayData.date + 'T12:00:00');
      dayCol.innerHTML = `<div class="cal-day-header">${dateObj.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short' })}</div>`;

      if (!dayData.slots || dayData.slots.length === 0) {
        dayCol.innerHTML += `<div class="cal-closed">Closed</div>`;
      } else {
        dayData.slots.forEach(slot => {
          const time = new Date(slot.time + 'Z');
          const timeStr = time.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
          const el = document.createElement('div');
          el.className = `cal-slot ${slot.available ? 'cal-slot-free' : 'cal-slot-booked'}`;
          el.textContent = timeStr + (slot.available ? '' : ' 🔒');
          if (!slot.available) {
            el.title = 'Booked';
            el.onclick = () => showBookingAtTime(slot.time);
          }
          dayCol.appendChild(el);
        });
      }
      grid.appendChild(dayCol);
    });
  } catch (err) {
    grid.innerHTML = `<div class="loading-center"><p style="color:red">Error loading calendar: ${err.message}</p></div>`;
  }
}

async function showBookingAtTime(slotTime) {
  try {
    const bookings = await apiFetch(`/api/bookings/list/${selectedBiz.id}`);
    const match = bookings.find(b => b.booking_time === slotTime || b.booking_time.startsWith(slotTime));
    if (!match) { toast('Info', 'Could not find booking details', 'info'); return; }

    document.getElementById('booking-details-content').innerHTML = `
      <table style="width:100%">
        <tr><td class="text-dim text-sm">Client</td><td><strong>${match.client_name}</strong></td></tr>
        <tr><td class="text-dim text-sm">Location</td><td>${match.client_location || '—'}</td></tr>
        <tr><td class="text-dim text-sm">Time</td><td>${new Date(match.booking_time).toLocaleString()}</td></tr>
        <tr><td class="text-dim text-sm">Status</td><td><span class="badge badge-${match.status === 'confirmed' ? 'blue' : 'green'}">${match.status}</span></td></tr>
      </table>
    `;
    const completeBtn = document.getElementById('complete-booking-btn');
    if (match.status === 'confirmed') {
      completeBtn.style.display = 'inline-flex';
      completeBtn.onclick = async () => {
        await apiFetch(`/api/bookings/${match.id}/status`, { method: 'PATCH', body: { status: 'completed' } });
        closeModal('booking-modal');
        loadWeek();
        toast('Done', 'Booking marked as completed', 'success');
      };
    } else {
      completeBtn.style.display = 'none';
    }

    const modal = document.getElementById('booking-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

// ─── MODAL HELPER ──────────────────────────────────────────────────────────────
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('active');
  setTimeout(() => m.style.display = 'none', 200);
}

// ─── SOCKET.IO ─────────────────────────────────────────────────────────────────
function initSocket(biz) {
  if (typeof io === 'undefined') return;
  if (socket) socket.disconnect();
  socket = io();
  socket.emit('join:seller', { channel: biz.pusher_channel || `biz-${biz.id}` });

  socket.on('order:waiting', (data) => {
    toast(`🔔 New Order — ${data.clientName}`, `${data.productTitle} ×${data.quantity}`, 'info', 8000);
    if (selectedBiz?.type === 'product') loadProducts();
  });

  socket.on('booking:new', (data) => {
    toast(`📅 New Booking — ${data.clientName}`, `Booked for ${new Date(data.bookingTime).toLocaleString()}`, 'info', 6000);
    if (selectedBiz?.type === 'service') loadWeek();
  });
}

// ─── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
async function initPushNotifications() {
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
    await apiFetch('/api/push/subscribe', { method: 'POST', body: sub });
  } catch (err) { console.error('Push registration failed:', err); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function formatCurrency(amount) {
  const symbol = selectedBiz?.currency_symbol || '$';
  return `${symbol}${parseFloat(amount).toFixed(2)}`;
}

function statusBadgeClass(status) {
  if (status === 'pending')   return 'badge-orange';
  if (status === 'completed') return 'badge-green';
  if (status === 'cancelled') return 'badge-red';
  if (status === 'confirmed') return 'badge-blue';
  return 'badge-orange';
}

function logout() {
  localStorage.clear();
  window.location.replace('/login.html');
}
