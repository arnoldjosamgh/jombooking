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

  if (biz.logo_url) {
    const brandIconContainer = document.querySelector('.brand-icon');
    if (brandIconContainer) {
      brandIconContainer.innerHTML = `<img src="${biz.logo_url}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`;
    }
  }

  const type = biz.type;
  document.getElementById('dashboard-type').textContent = type === 'product' ? '🛍️ Point of Sale' : type === 'service' ? '📅 Service Calendar' : '🛍️ POS & 📅 Calendar';

  renderTabs(type);

  if (type === 'product' || type === 'both') {
    renderPOS();
  } else {
    renderCalendar();
  }

  initSocket(biz);
  checkFirstLogin(biz);
  pollPending(); // Initial poll for pending orders
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

async function uploadSellerLogo() {
  const fileInput = document.getElementById('ob-logo');
  if (!fileInput.files.length) {
    toast('No file', 'Please select an image first', 'error');
    return;
  }
  
  try {
    const file = fileInput.files[0];
    const logo_url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    await apiFetch(`/api/businesses/${selectedBiz.slug}/logo`, {
      method: 'PUT',
      body: { logo_url }
    });
    
    // Update local state and UI
    selectedBiz.logo_url = logo_url;
    setupBiz(selectedBiz);
    toast('Success', 'Logo updated successfully', 'success');
  } catch (err) {
    toast('Error', 'Failed to upload logo: ' + err.message, 'error');
  }
}

// ─── POS SYSTEM ────────────────────────────────────────────────────────────────
async function renderPOS() { setActiveTab("tab-pos");
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
let allServices    = [];   // services for this business
let selectedSvcId  = null; // currently-viewed service

async function renderCalendar() { setActiveTab("tab-calendar");
  const main = document.getElementById('seller-content');
  const tpl  = document.getElementById('tpl-calendar');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));

  currentWeekStart = getMonday(new Date());

  // Load services first
  await loadServices();
}

async function loadServices() {
  try {
    allServices = await apiFetch(`/api/services/${selectedBiz.slug}`);
  } catch(e) { allServices = []; }

  renderServicePanel();

  if (allServices.length > 0) {
    selectedSvcId = allServices[0].id;
    renderServicePicker();
    loadWeek();
  } else {
    // No services yet — show empty-state inside calendar
    const grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = `<div class="cal-no-services">No services yet. Add your first service above.</div>`;
  }
}

function renderServicePanel() {
  // Insert service management UI above the calendar grid
  const calendarContainer = document.querySelector('.calendar-container');
  if (!calendarContainer) return;

  // Remove old panel if exists
  const old = document.getElementById('service-mgmt-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'service-mgmt-panel';
  panel.className = 'service-mgmt-panel';
  panel.innerHTML = `
    <div class="service-mgmt-header">
      <h3>Your Services</h3>
      <button class="btn btn-primary" onclick="openAddServiceModal()">+ Add Service</button>
    </div>
    <div class="service-chips" id="service-chips">
      ${allServices.length === 0
        ? '<span class="text-dim text-sm">No services yet</span>'
        : allServices.map(s => `
            <div class="service-chip" id="chip-${s.id}">
              <strong>${s.name}</strong>
              <span>${formatCurrency(s.price)} &bull; ${s.duration_minutes} min</span>
              <button class="chip-del" onclick="deleteService(${s.id}, event)">×</button>
            </div>
          `).join('')
      }
    </div>
  `;

  // Insert BEFORE the calendar week nav
  calendarContainer.insertBefore(panel, calendarContainer.firstChild);
}

function openAddServiceModal() {
  // Build modal inline
  let modal = document.getElementById('add-service-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'add-service-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3 class="mb-16">Add New Service</h3>
        <form id="add-service-form">
          <div class="form-group">
            <label>Service Name</label>
            <input type="text" id="as-name" placeholder="e.g. Hair Cut" required>
          </div>
          <div class="form-group">
            <label>Price</label>
            <input type="number" step="0.01" id="as-price" placeholder="e.g. 25.00" required>
          </div>
          <div class="form-group">
            <label>Duration per Session (minutes)</label>
            <input type="number" id="as-duration" value="30" min="5" step="5" required>
          </div>
          <div class="flex justify-end gap-8 mt-24">
            <button type="button" class="btn btn-outline" onclick="closeModal('add-service-modal')">Cancel</button>
            <button type="submit" class="btn btn-primary">Add Service</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#add-service-form').addEventListener('submit', submitAddService);
  }
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
}

async function submitAddService(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Adding...';
  try {
    const svc = await apiFetch('/api/services', {
      method: 'POST',
      body: {
        business_id:      selectedBiz.id,
        name:             document.getElementById('as-name').value,
        price:            document.getElementById('as-price').value,
        duration_minutes: document.getElementById('as-duration').value
      }
    });
    allServices.push(svc);
    closeModal('add-service-modal');
    e.target.reset();
    renderServicePanel();
    renderServicePicker();
    if (!selectedSvcId) { selectedSvcId = svc.id; loadWeek(); }
    toast('Added!', svc.name + ' service added', 'success');
  } catch (err) {
    toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Add Service';
  }
}

async function deleteService(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this service?')) return;
  try {
    await apiFetch(`/api/services/${id}`, { method: 'DELETE' });
    allServices = allServices.filter(s => s.id !== id);
    if (selectedSvcId === id) selectedSvcId = allServices[0]?.id || null;
    renderServicePanel();
    renderServicePicker();
    if (selectedSvcId) loadWeek(); else {
      const grid = document.getElementById('calendar-grid');
      if (grid) grid.innerHTML = `<div class="cal-no-services">No services. Add one above.</div>`;
    }
    toast('Deleted', 'Service removed', 'success');
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

function renderServicePicker() {
  if (allServices.length === 0) return;
  let picker = document.getElementById('service-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'service-picker';
    picker.className = 'service-picker-bar';
    // Insert before calendar-grid
    const grid = document.getElementById('calendar-grid');
    if (grid) grid.parentNode.insertBefore(picker, grid);
  }
  picker.innerHTML = `
    <span class="text-sm text-dim font-bold mr-8">Viewing slots for:</span>
    <div class="service-picker-tabs">
      ${allServices.map(s =>
        `<button class="svc-tab ${s.id === selectedSvcId ? 'active' : ''}" onclick="switchService(${s.id})"
          title="${s.duration_minutes} min — ${formatCurrency(s.price)}">${s.name}</button>`
      ).join('')}
    </div>
  `;
}

function switchService(id) {
  selectedSvcId = id;
  renderServicePicker();
  loadWeek();
}

function getMonday(d) {
  const day  = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m    = new Date(d);
  m.setDate(diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function prevWeek() { currentWeekStart.setDate(currentWeekStart.getDate() - 7); loadWeek(); }
function nextWeek() { currentWeekStart.setDate(currentWeekStart.getDate() + 7); loadWeek(); }

async function loadWeek() {
  const label = document.getElementById('calendar-week-label');
  const grid  = document.getElementById('calendar-grid');
  if (!label || !grid) return;
  if (!selectedSvcId) return;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  label.textContent = `${days[0].toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`;

  grid.innerHTML = `<div class="loading-center" style="grid-column:1/-1"><div class="spinner"></div></div>`;

  try {
    const slotPromises = days.map(d => {
      const dateStr = d.toISOString().split('T')[0];
      return apiFetch(`/api/slots/${selectedBiz.slug}?date=${dateStr}&service_id=${selectedSvcId}`)
        .catch(() => ({ date: dateStr, slots: [] }));
    });
    const weekData = await Promise.all(slotPromises);

    grid.innerHTML = '';
    weekData.forEach(dayData => {
      const dayCol  = document.createElement('div');
      dayCol.className = 'cal-day-col';
      const dateObj = new Date(dayData.date + 'T12:00:00');
      dayCol.innerHTML = `<div class="cal-day-header">${dateObj.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</div>`;

      if (!dayData.slots || dayData.slots.length === 0) {
        dayCol.innerHTML += `<div class="cal-closed">Closed</div>`;
      } else {
        dayData.slots.forEach(slot => {
          const time    = new Date(slot.time + 'Z');
          const timeStr = time.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
          const el      = document.createElement('div');

          if (!slot.available && !slot.blocked_by_seller) {
            // Booked by a client
            el.className = 'cal-slot cal-slot-booked';
            el.innerHTML = `${timeStr} 🔒`;
            el.title     = 'Booked by client — click for details';
            el.onclick   = () => showBookingAtTime(slot.time);
          } else if (slot.blocked_by_seller) {
            // Manually blocked — can unblock
            el.className = 'cal-slot cal-slot-blocked';
            el.innerHTML = `${timeStr} 🚫`;
            el.title     = 'Blocked by you — click to unblock';
            el.onclick   = () => toggleBlockSlot(slot.time, true);
          } else {
            // Free slot — seller can block it
            el.className = 'cal-slot cal-slot-free';
            el.innerHTML = `${timeStr}`;
            el.title     = 'Available — click to block';
            el.onclick   = () => toggleBlockSlot(slot.time, false);
          }
          dayCol.appendChild(el);
        });
      }
      grid.appendChild(dayCol);
    });
  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:32px;text-align:center;color:red">Error loading calendar: ${err.message}</div>`;
  }
}

async function toggleBlockSlot(slotTime, currentlyBlocked) {
  if (!selectedSvcId) return;
  try {
    if (currentlyBlocked) {
      await apiFetch('/api/services/block', { method: 'DELETE', body: { business_id: selectedBiz.id, service_id: selectedSvcId, slot_time: slotTime } });
      toast('Unblocked', 'Slot is now available', 'success');
    } else {
      if (!confirm('Block this slot? Clients won\'t be able to book it.')) return;
      await apiFetch('/api/services/block', { method: 'POST', body: { business_id: selectedBiz.id, service_id: selectedSvcId, slot_time: slotTime } });
      toast('Blocked', 'Slot marked as unavailable', 'success');
    }
    loadWeek(); // refresh
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

async function showBookingAtTime(slotTime) {
  try {
    const bookings = await apiFetch(`/api/bookings/list/${selectedBiz.id}`);
    const match = bookings.find(b => b.booking_time === slotTime || (slotTime && b.booking_time && b.booking_time.startsWith(slotTime.substring(0,16))));
    if (!match) { toast('Info', 'No booking details found for this slot', 'info'); return; }

    document.getElementById('booking-details-content').innerHTML = `
      <table style="width:100%">
        <tr><td class="text-dim text-sm" style="padding:8px 0">Client</td><td><strong>${match.client_name}</strong></td></tr>
        <tr><td class="text-dim text-sm" style="padding:8px 0">Service</td><td>${match.service_name || '—'}</td></tr>
        <tr><td class="text-dim text-sm" style="padding:8px 0">Price</td><td>${match.service_price ? formatCurrency(match.service_price) : '—'}</td></tr>
        <tr><td class="text-dim text-sm" style="padding:8px 0">Location</td><td>${match.client_location || '—'}</td></tr>
        <tr><td class="text-dim text-sm" style="padding:8px 0">Time</td><td>${new Date(match.booking_time).toLocaleString()}</td></tr>
        <tr><td class="text-dim text-sm" style="padding:8px 0">Status</td><td><span class="badge badge-${match.status === 'confirmed' ? 'blue' : 'green'}">${match.status}</span></td></tr>
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


// ─── TABS & HISTORY & PENDING ───────────────────────────────────────────────

function renderTabs(type) {
  const tabs = document.getElementById('seller-tabs');
  tabs.style.display = 'flex';
  
  let html = '';
  if (type === 'product' || type === 'both') {
    html += `<button class="btn btn-outline" id="tab-pos" onclick="renderPOS()">Point of Sale</button>`;
  }
  if (type === 'service' || type === 'both') {
    html += `<button class="btn btn-outline" id="tab-calendar" onclick="renderCalendar()">Calendar</button>`;
  }
  html += `<button class="btn btn-outline" id="tab-pending" onclick="renderPending()">Pending</button>`;
  html += `<button class="btn btn-outline" id="tab-history" onclick="renderHistory()">History</button>`;
  
  tabs.innerHTML = html;
}

function setActiveTab(tabId) {
  document.querySelectorAll('#seller-tabs .btn').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-outline');
  });
  const el = document.getElementById(tabId);
  if(el) {
    el.classList.remove('btn-outline');
    el.classList.add('btn-primary');
  }
}

async function renderPending() {
  setActiveTab('tab-pending');
  const main = document.getElementById('seller-content');
  const tpl = document.getElementById('tpl-pending');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));
  
  const list = document.getElementById('pending-list');
  list.innerHTML = '<div class="spinner"></div>';
  
  try {
    let html = '';
    
    // Load Orders
    if (selectedBiz.type === 'product' || selectedBiz.type === 'both') {
      const orders = await apiFetch(`/api/orders/list/${selectedBiz.slug}?status=pending`);
      if (orders.length > 0) {
        html += `<h4>🛍️ Product Orders</h4><div class="list-group mb-24">`;
        html += orders.map(o => `
          <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${o.product_title}</strong> (x${o.quantity})<br>
              <span class="text-dim text-sm">${o.client_name} • ${new Date(o.created_at).toLocaleString()}</span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="completeOrder(${o.id})">Mark Delivered</button>
          </div>
        `).join('');
        html += '</div>';
      }
    }
    
    // Load Bookings
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const bookings = await apiFetch(`/api/bookings/list/${selectedBiz.slug}?status=confirmed`);
      const pendingBookings = bookings.filter(b => new Date(b.booking_time) > new Date(Date.now() - 86400000)); // Only show recent/upcoming
      if (pendingBookings.length > 0) {
        html += `<h4>📅 Service Bookings</h4><div class="list-group">`;
        html += pendingBookings.map(b => `
          <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${b.service_name || 'Booking'}</strong><br>
              <span class="text-dim text-sm">${b.client_name} • ${new Date(b.booking_time).toLocaleString()}</span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="completeBooking(${b.id})">Mark Completed</button>
          </div>
        `).join('');
        html += '</div>';
      }
    }
    
    if (!html) html = '<div class="text-dim">No pending items.</div>';
    list.innerHTML = html;
    
  } catch(e) {
    list.innerHTML = `<div class="text-red">Error loading pending items: ${e.message}</div>`;
  }
}

async function renderHistory() {
  setActiveTab('tab-history');
  const main = document.getElementById('seller-content');
  const tpl = document.getElementById('tpl-history');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));
  
  const list = document.getElementById('history-list');
  list.innerHTML = '<div class="spinner"></div>';
  
  try {
    let items = [];
    
    if (selectedBiz.type === 'product' || selectedBiz.type === 'both') {
      const orders = await apiFetch(`/api/orders/list/${selectedBiz.slug}?status=completed`);
      items = items.concat(orders.map(o => ({
        type: 'Product',
        title: `${o.product_title} (x${o.quantity})`,
        client: o.client_name,
        date: new Date(o.created_at),
        seller: o.seller_username || 'Unknown',
        price: o.total_price
      })));
    }
    
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const bookings = await apiFetch(`/api/bookings/list/${selectedBiz.slug}?status=completed`);
      items = items.concat(bookings.map(b => ({
        type: 'Service',
        title: b.service_name || 'Booking',
        client: b.client_name,
        date: new Date(b.booking_time),
        seller: b.seller_username || 'Unknown',
        price: b.service_price
      })));
    }
    
    items.sort((a,b) => b.date - a.date); // Sort newest first
    
    if (items.length === 0) {
      list.innerHTML = '<div class="text-dim">No transaction history.</div>';
      return;
    }
    
    list.innerHTML = `<div class="list-group">` + items.map(i => `
      <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${i.title}</strong> <span class="badge" style="background:#e2e8f0;color:#475569;font-size:0.7rem">${i.type}</span><br>
          <span class="text-dim text-sm">Client: ${i.client} • ${i.date.toLocaleString()}</span>
        </div>
        <div style="text-align:right">
          <div class="font-bold">${formatCurrency(i.price || 0)}</div>
          <div class="text-xs" style="color:var(--accent-green);font-weight:bold;">Sold by: ${i.seller}</div>
        </div>
      </div>
    `).join('') + '</div>';
    
  } catch(e) {
    list.innerHTML = `<div class="text-red">Error loading history: ${e.message}</div>`;
  }
}

async function completeOrder(orderId) {
  try {
    await apiFetch(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'completed' }});
    toast('Success', 'Order marked as delivered/completed.', 'success');
    renderPending();
    pollPending(); // update badge
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function completeBooking(bookingId) {
  try {
    await apiFetch(`/api/bookings/${bookingId}/status`, { method: 'PATCH', body: { status: 'completed' }});
    toast('Success', 'Booking marked as completed.', 'success');
    renderPending();
    pollPending(); // update badge
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function pollPending() {
  if (!selectedBiz) return;
  try {
    let count = 0;
    if (selectedBiz.type === 'product' || selectedBiz.type === 'both') {
      const orders = await apiFetch(`/api/orders/list/${selectedBiz.slug}?status=pending`);
      count += orders.length;
    }
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const bookings = await apiFetch(`/api/bookings/list/${selectedBiz.slug}?status=confirmed`);
      // Only count bookings that are in the past or today, not future days
      const today = new Date();
      count += bookings.filter(b => new Date(b.booking_time) < today).length;
    }
    
    const fab = document.getElementById('fab-pending');
    const badge = document.getElementById('fab-badge');
    const tab = document.getElementById('tab-pending');
    
    if (count > 0) {
      if(fab) fab.style.display = 'flex';
      if(badge) {
        badge.textContent = count;
        badge.style.display = 'block';
      }
      if(tab) tab.innerHTML = `Pending <span style="background:red;color:white;border-radius:50%;padding:2px 6px;font-size:0.7rem;margin-left:4px;">${count}</span>`;
    } else {
      if(fab) fab.style.display = 'none';
      if(badge) badge.style.display = 'none';
      if(tab) tab.innerHTML = 'Pending';
    }
  } catch(e) {
    console.error('Error polling pending:', e);
  }
}

// Poll every 30 seconds
setInterval(pollPending, 30000);
