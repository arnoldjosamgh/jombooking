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
        
      // Hide the spinner and show a prompt to select a business
      document.getElementById('no-biz').innerHTML = `
        <div style="font-size:2rem;margin-bottom:12px">🏢</div>
        <p>Welcome, Tech Admin.</p>
        <p class="text-dim">Please select a business from the top menu.</p>
      `;
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

  // Show demo banner if applicable
  if (localStorage.getItem('is_demo') === '1') {
    const banner = document.getElementById('demo-banner');
    if (banner) banner.style.display = 'block';
  }

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

  // Wire up settings form
  const sf = document.getElementById('settings-form');
  if (sf && !sf._bound) {
    sf._bound = true;
    sf.addEventListener('submit', saveSettings);
  }

  initSocket(biz);
  checkFirstLogin(biz);
  pollPending(); // Initial poll for pending orders

  // Show floating chat button
  const floatChatBtn = document.getElementById('seller-float-chat-btn');
  if (floatChatBtn) floatChatBtn.style.display = 'flex';
  // Poll unread counts every 30s
  renderSellerChatThreads();
  
  // Show first-login setup prompts if not seen
  setTimeout(showSetupPrompts, 2000);
}

// ─── POST-LOGIN SETUP PROMPTS ────────────────────────────────────────────────
async function showSetupPrompts() {
  const username = localStorage.getItem('last_username');
  if (!username) return;
  
  // 1. Check Push Notifications
  if (('Notification' in window) && Notification.permission === 'default' && !localStorage.getItem('prompted_push_' + username)) {
    localStorage.setItem('prompted_push_' + username, '1');
    if (confirm('🔔 Enable Push Notifications?\n\nGet notified instantly when you receive new orders or bookings.')) {
      await enablePushNotifications();
    }
  }
  
  // 2. Check Biometrics
  if (window.PublicKeyCredential && !localStorage.getItem('bio_registered_' + username) && !localStorage.getItem('prompted_bio_' + username)) {
    localStorage.setItem('prompted_bio_' + username, '1');
    setTimeout(() => {
      if (confirm('👆 Set Up Biometric Login?\n\nUse your fingerprint or Face ID to log in next time securely.')) {
        setupBiometrics();
      }
    }, 1000); // Wait a second before second prompt so they don't overlap awkwardly
  }
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

  currentWeekStart = new Date();
  currentWeekStart.setHours(0, 0, 0, 0);

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
        // Skip rendering closed days per user request
        return;
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
      // Use POST /unblock to avoid browser/proxy dropping DELETE body
      await apiFetch('/api/services/unblock', { method: 'POST', body: { business_id: selectedBiz.id, service_id: selectedSvcId, slot_time: slotTime } });
      toast('Unblocked', 'Slot is now available again', 'success');
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
        <tr><td class="text-dim text-sm" style="padding:8px 0">Status</td><td><span class="badge badge-${match.status === 'confirmed' ? 'blue' : (match.status === 'completed' ? 'green' : 'red')}">${match.status}</span></td></tr>
      </table>
    `;
    const completeBtn = document.getElementById('complete-booking-btn');
    const cancelBtn = document.getElementById('cancel-booking-btn');
    
    if (match.status === 'confirmed') {
      completeBtn.style.display = 'inline-flex';
      cancelBtn.style.display = 'inline-block';
      
      completeBtn.onclick = () => {
        closeModal('booking-modal');
        completeBooking(match);
      };
      
      // Store ID for cancel modal
      document.getElementById('cancel-booking-id').value = match.id;
    } else {
      completeBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    }
    const modal = document.getElementById('booking-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

function promptCancelBooking() {
  closeModal('booking-modal');
  const modal = document.getElementById('cancel-modal');
  document.getElementById('cancel-reason').value = '';
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
}

async function submitCancelBooking() {
  const id = document.getElementById('cancel-booking-id').value;
  const reason = document.getElementById('cancel-reason').value.trim();
  
  if (!reason) {
    toast('Reason Required', 'Please provide a reason for cancelling', 'error');
    return;
  }
  
  try {
    await apiFetch(`/api/bookings/${id}/cancel`, { 
      method: 'PATCH', 
      body: { reason } 
    });
    closeModal('cancel-modal');
    loadWeek();
    toast('Cancelled', 'Booking cancelled and client notified', 'success');
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

  // Also listen for incoming client chat messages
  socket.on('chat:message', async (msg) => {
    if (typeof activeChatClient !== 'undefined' && activeChatClient && msg.client_id == activeChatClient) {
      const messages = await apiFetch(`/api/messages/${selectedBiz.id}/${activeChatClient}`);
      renderChatMessages(messages);
    } else if (msg.sender === 'client') {
      toast('💬 New Message', 'New message from a client', 'info');
      // Refresh threads if panel is open, otherwise just show badge
      if (document.getElementById('seller-chat-panel').style.display === 'flex') {
        renderSellerChatThreads();
      } else {
        const badge = document.getElementById('seller-chat-badge');
        if (badge) {
          badge.style.display = 'flex';
          badge.textContent = parseInt(badge.textContent || 0) + 1;
        }
      }
    }
  });

  // Notify any listeners that socket is ready
  window.dispatchEvent(new Event('socket:ready'));
}

// ─── SELLER FLOATING CHAT PANEL ───────────────────────────────────────────────
async function toggleSellerChatPanel() {
  const panel = document.getElementById('seller-chat-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'flex' : 'none';
  
  if (isHidden) {
    // Clear badge
    const badge = document.getElementById('seller-chat-badge');
    if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
    await renderSellerChatThreads();
  }
}

async function renderSellerChatThreads() {
  const container = document.getElementById('seller-chat-threads');
  if (!container) return;
  if (!selectedBiz) return;
  
  container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.9rem;">Loading messages...</div>';
  
  try {
    const threads = await apiFetch(`/api/messages/threads/${selectedBiz.id}`);
    
    if (threads.length === 0) {
      container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.9rem;">No client messages yet.</div>';
      return;
    }
    
    container.innerHTML = threads.map(t => {
      const isUnread = t.unread_count > 0;
      return `
        <div onclick="openSellerChat(${t.client_id}, '${t.client_name.replace(/'/g,"\\'")}')" style="padding:12px 16px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; gap:12px; align-items:center; transition:background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
          <div style="width:40px; height:40px; border-radius:50%; background:#e2e8f0; color:#1a2461; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:1.1rem; flex-shrink:0;">
            ${t.client_name.charAt(0).toUpperCase()}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
              <div style="font-weight:600; font-size:0.95rem; color:#1a2461; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.client_name}</div>
              <div style="font-size:0.7rem; color:#94a3b8;">${new Date(t.last_at).toLocaleDateString([], {month:'short', day:'numeric'})}</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size:0.85rem; color:${isUnread ? '#1a2461' : '#64748b'}; font-weight:${isUnread ? '600' : '400'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${t.last_sender === 'seller' ? 'You: ' : ''}${t.last_message}
              </div>
              ${isUnread ? `<div style="background:#5b67f6; color:#fff; font-size:0.7rem; font-weight:700; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center;">${t.unread_count}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Update badge with total unread threads
    const totalUnread = threads.reduce((sum, t) => sum + (t.unread_count > 0 ? 1 : 0), 0);
    const badge = document.getElementById('seller-chat-badge');
    const panel = document.getElementById('seller-chat-panel');
    if (badge) {
      if (totalUnread > 0 && panel && panel.style.display === 'none') {
        badge.style.display = 'flex';
        badge.textContent = totalUnread;
      } else {
        badge.style.display = 'none';
        badge.textContent = '0';
      }
    }
  } catch (err) {
    container.innerHTML = `<div style="padding:24px; text-align:center; color:red; font-size:0.9rem;">Error: ${err.message}</div>`;
  }
}

async function openSellerChat(clientId, clientName) {
  // Hide the panel and open the modal chat
  document.getElementById('seller-chat-panel').style.display = 'none';
  const badge = document.getElementById('seller-chat-badge');
  if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
  openChat(clientId, clientName); // Uses existing openChat function
}

function openBroadcastModal() {
  document.getElementById('seller-chat-panel').style.display = 'none';
  const modal = document.getElementById('broadcast-modal');
  document.getElementById('broadcast-msg').value = '';
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
}

async function sendBroadcast() {
  const msg = document.getElementById('broadcast-msg').value.trim();
  if (!msg) {
    toast('Required', 'Please enter a message', 'error');
    return;
  }
  
  const btn = document.getElementById('broadcast-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  
  try {
    // Get all clients from threads
    const threads = await apiFetch(`/api/messages/threads/${selectedBiz.id}`);
    if (threads.length === 0) {
      toast('No Clients', 'You have no clients to message yet.', 'info');
      closeModal('broadcast-modal');
      return;
    }
    
    // Send message to each client (simplistic approach for now)
    let successCount = 0;
    for (const t of threads) {
      try {
        await apiFetch('/api/messages', {
          method: 'POST',
          body: { business_id: selectedBiz.id, client_id: t.client_id, sender: 'seller', content: msg }
        });
        successCount++;
      } catch (e) {
        console.error('Failed to send to client', t.client_id, e);
      }
    }
    
    closeModal('broadcast-modal');
    toast('Broadcast Sent', `Message sent to ${successCount} clients.`, 'success');
  } catch (err) {
    toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send to All';
  }
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
            <div style="display:flex; gap:8px;">
              <button class="btn btn-outline btn-sm" onclick="openChat('${o.client_id}', '${o.client_name}')">✉️ Message</button>
              <button class="btn btn-primary btn-sm" onclick="completeOrder(${o.id})">Mark Delivered</button>
            </div>
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
            <div style="display:flex; gap:8px;">
              <button class="btn btn-outline btn-sm" onclick="openChat('${b.client_id}', '${b.client_name}')">✉️ Message</button>
              <button class="btn btn-primary btn-sm" onclick='completeBooking(${JSON.stringify(b).replace(/'/g, "&#39;")})'>Mark Completed</button>
            </div>
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
        price: o.total_price,
        raw: o
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
        price: b.service_price,
        raw: b
      })));
    }
    
    items.sort((a,b) => b.date - a.date); // Sort newest first
    window._historyData = items;
    
    if (items.length === 0) {
      list.innerHTML = '<div class="text-dim">No transaction history.</div>';
      return;
    }
    
    list.innerHTML = `<div class="list-group">` + items.map((i, idx) => `
      <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${i.title}</strong> <span class="badge" style="background:#e2e8f0;color:#475569;font-size:0.7rem">${i.type}</span><br>
          <span class="text-dim text-sm">Client: ${i.client} • ${i.date.toLocaleString()}</span><br>
          <span class="text-xs" style="color:#94a3b8;">${i.raw.receipt_number || ('#' + i.raw.id)}</span>
        </div>
        <div style="text-align:right">
          <div class="font-bold">${formatCurrency(i.price || 0)}</div>
          <div class="text-xs" style="color:var(--accent-green);font-weight:bold;margin-bottom:6px;">Sold by: ${i.seller || '—'}</div>
          <button class="btn btn-outline" style="padding:6px 14px;font-size:0.78rem;" onclick="showReceipt(${idx})">🧾 Receipt</button>
        </div>
      </div>
    `).join('') + '</div>';
    
  } catch(e) {
    list.innerHTML = `<div class="text-red">Error loading history: ${e.message}</div>`;
  }
}

function showReceipt(idx) {
  const items = window._historyData;
  if (!items || !items[idx]) return;
  const i = items[idx];
  const r = i.raw;
  
  const receiptNum = r.receipt_number || (i.type === 'Product' ? `ORD-${String(r.id).padStart(5,'0')}` : `BKG-${String(r.id).padStart(5,'0')}`);
  const bizName = r.business_name || selectedBiz?.name || '—';
  const bizLocation = r.business_location || selectedBiz?.location || '';
  const bizPhone = r.business_phone || selectedBiz?.phone_number || '';
  const bizLogo = r.business_logo || selectedBiz?.logo_url || '';

  const content = document.getElementById('seller-receipt-content');
  content.innerHTML = `
    <div style="text-align:center; padding-bottom:20px; border-bottom:2px dashed #e2e8f0; margin-bottom:20px;">
      ${bizLogo ? `<img src="${bizLogo}" alt="Logo" style="height:60px; object-fit:contain; margin-bottom:8px; display:block; margin-left:auto; margin-right:auto;">` : ''}
      <h2 style="font-size:1.3rem; font-weight:700; color:#1a2461; margin:0 0 4px;">${bizName}</h2>
      ${bizLocation ? `<p style="font-size:0.8rem; color:#64748b; margin:2px 0;">${bizLocation}</p>` : ''}
      ${bizPhone ? `<p style="font-size:0.8rem; color:#64748b; margin:2px 0;">📞 ${bizPhone}</p>` : ''}
    </div>

    <div style="background:#f8fafc; border-radius:8px; padding:14px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-size:0.78rem; color:#64748b; font-weight:600;">RECEIPT NO.</span>
        <span style="font-size:0.78rem; font-weight:700; color:#1a2461;">${receiptNum}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-size:0.78rem; color:#64748b; font-weight:600;">DATE</span>
        <span style="font-size:0.78rem; color:#1a2461;">${i.date.toLocaleString()}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-size:0.78rem; color:#64748b; font-weight:600;">CLIENT</span>
        <span style="font-size:0.78rem; color:#1a2461;">${i.client}</span>
      </div>
      ${r.client_location ? `
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-size:0.78rem; color:#64748b; font-weight:600;">CLIENT LOCATION</span>
        <span style="font-size:0.78rem; color:#1a2461;">${r.client_location}</span>
      </div>` : ''}
    </div>

    <div style="border-top:1px solid #e2e8f0; padding-top:14px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px dashed #f1f5f9;">
        <div>
          <div style="font-weight:600; font-size:0.9rem; color:#1a2461;">${i.type === 'Product' ? r.product_title : (r.service_name || 'Service')}</div>
          ${i.type === 'Product' ? `<div style="font-size:0.75rem; color:#64748b;">Qty: ${r.quantity}</div>` : `<div style="font-size:0.75rem; color:#64748b;">${new Date(r.booking_time || r.created_at).toLocaleString()}</div>`}
        </div>
        <div style="font-weight:700; color:#1a2461;">${formatCurrency(i.price || 0)}</div>
      </div>
      <div style="display:flex; justify-content:space-between; padding-top:12px;">
        <span style="font-size:1rem; font-weight:700; color:#1a2461;">TOTAL</span>
        <span style="font-size:1.1rem; font-weight:700; color:#5b67f6;">${formatCurrency(i.price || 0)}</span>
      </div>
    </div>

    <div style="text-align:center; border-top:2px dashed #e2e8f0; padding-top:16px;">
      <div style="font-size:0.75rem; color:#94a3b8;">Thank you for choosing <strong>${bizName}</strong></div>
      <div style="font-size:0.7rem; color:#cbd5e1; margin-top:4px;">Powered by Jomish Business Suite</div>
    </div>
  `;

  const modal = document.getElementById('seller-receipt-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
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

let currentBookingToComplete = null;

function completeBooking(booking) {
  currentBookingToComplete = booking;
  document.getElementById('complete-booking-id').value = booking.id;
  document.getElementById('complete-final-price').value = booking.service_price || 0;
  
  const modal = document.getElementById('complete-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
}

async function confirmCompleteBooking() {
  const priceInput = document.getElementById('complete-final-price').value;
  const finalPrice = parseFloat(priceInput) || 0;
  const bk = currentBookingToComplete;
  if (!bk) return;

  try {
    const res = await apiFetch(`/api/bookings/${bk.id}/status`, { 
      method: 'PATCH', 
      body: { status: 'completed', final_price: finalPrice }
    });
    
    closeModal('complete-modal');
    toast('Success', 'Booking marked as completed.', 'success');
    renderPending();
    pollPending(); // update badge
    
    // Generate PDF receipt
    generateReceiptPDF(bk, finalPrice);
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

function generateReceiptPDF(bk, finalPrice) {
  // Populate the hidden template
  document.getElementById('receipt-biz-name').textContent = bk.business_name || selectedBiz.name;
  document.getElementById('receipt-biz-location').textContent = bk.business_location || selectedBiz.location || '';
  document.getElementById('receipt-id').textContent = bk.receipt_number || bk.id;
  document.getElementById('receipt-date').textContent = new Date().toLocaleString();
  document.getElementById('receipt-client').textContent = bk.client_name;
  document.getElementById('receipt-service').textContent = bk.service_name || 'Service';
  document.getElementById('receipt-price').textContent = '$' + finalPrice.toFixed(2);
  document.getElementById('receipt-total').textContent = '$' + finalPrice.toFixed(2);
  
  const element = document.getElementById('receipt-content');
  // Temporarily show container so html2pdf can read it
  document.getElementById('receipt-container').style.display = 'block';
  
  const opt = {
    margin:       0,
    filename:     `Receipt-${bk.receipt_number || bk.id}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'mm', format: [80, 150], orientation: 'portrait' }
  };
  
  html2pdf().set(opt).from(element).save().then(() => {
    document.getElementById('receipt-container').style.display = 'none';
  });
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

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function openSettings() {
  if (!selectedBiz) {
    toast('Not Ready', 'Business data is still loading. Please wait.', 'error');
    return;
  }

  // open_time may come as '08:00:00' — strip seconds for <input type=time>
  const trimTime = (t) => t ? t.substring(0, 5) : '';

  document.getElementById('s-open-time').value = trimTime(selectedBiz.open_time);
  document.getElementById('s-close-time').value = trimTime(selectedBiz.close_time);
  document.getElementById('s-lunch-start').value = trimTime(selectedBiz.lunch_start);
  document.getElementById('s-lunch-end').value = trimTime(selectedBiz.lunch_end);
  document.getElementById('s-duration').value = selectedBiz.session_duration_minutes || 30;
  document.getElementById('s-currency').value = selectedBiz.currency_symbol || 'UGX';
  document.getElementById('s-phone').value = selectedBiz.phone_number || '';
  document.getElementById('s-location').value = selectedBiz.location || '';
  
  // open_days can be an array of ints or strings — normalize
  const days = (selectedBiz.open_days || []).map(d => parseInt(d));
  document.querySelectorAll('#s-open-days input[type="checkbox"]').forEach(cb => {
    cb.checked = days.includes(parseInt(cb.value));
  });

  openModal('settings-modal');
}

async function saveSettings(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const days = [];
    document.querySelectorAll('#s-open-days input[type="checkbox"]:checked').forEach(cb => {
      days.push(parseInt(cb.value));
    });

    const payload = {
      open_time: document.getElementById('s-open-time').value,
      close_time: document.getElementById('s-close-time').value,
      lunch_start: document.getElementById('s-lunch-start').value,
      lunch_end: document.getElementById('s-lunch-end').value,
      session_duration_minutes: document.getElementById('s-duration').value || null,
      currency_symbol: document.getElementById('s-currency').value,
      phone_number: document.getElementById('s-phone').value,
      location: document.getElementById('s-location').value,
      open_days: days
    };

    await apiFetch(`/api/businesses/${selectedBiz.slug}/settings`, {
      method: 'PUT',
      body: payload
    });

    toast('Settings Saved', 'Your business settings have been updated.', 'success');
    closeModal('settings-modal');
    
    // Refresh biz data
    const updatedBiz = await apiFetch(`/api/businesses/${selectedBiz.slug}`);
    setupBiz(updatedBiz);
  } catch (err) {
    toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Settings';
  }
}


// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
async function enablePushNotifications() {
  const btn = document.getElementById('push-enable-btn');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    toast('Not Supported', 'Push notifications are not supported on this device/browser.', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Requesting permission…'; }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'denied') {
      toast(
        '🔔 Notifications Blocked',
        'To enable: open your browser Settings → Site Settings → Notifications → find this site and set to Allow.',
        'info',
        7000
      );
      if (btn) { btn.disabled = false; btn.textContent = '🔔 Enable Push Notifications'; }
      return;
    }
    if (permission !== 'granted') {
      if (btn) { btn.disabled = false; btn.textContent = '🔔 Enable Push Notifications'; }
      return;
    }
    // Get VAPID public key
    const vapidPublicKey = await fetch('/api/push/vapidPublicKey').then(r => r.text());
    if (!vapidPublicKey) throw new Error('Server VAPID key missing');

    const sw = await navigator.serviceWorker.ready;
    const subscription = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });

    // Save subscription to server
    await apiFetch('/api/push/subscribe', { method: 'POST', body: subscription });
    toast('Notifications On! 🔔', 'You will now receive push notifications for new orders and bookings.', 'success', 4000);
    if (btn) btn.textContent = '✅ Notifications Enabled';
  } catch (err) {
    toast('Error', err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔔 Enable Push Notifications'; }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ─── BIOMETRIC SETUP (from settings) ─────────────────────────────────────────
async function setupBiometrics() {
  const btn = document.getElementById('bio-setup-btn');
  if (!window.PublicKeyCredential) {
    toast('Not Supported', 'Biometrics are not supported on this device/browser.', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Setting up…'; }
  try {
    const SimpleWebAuthnBrowser = window.SimpleWebAuthnBrowser;
    if (!SimpleWebAuthnBrowser) throw new Error('WebAuthn library not loaded');
    const { startRegistration } = SimpleWebAuthnBrowser;

    const options = await apiFetch('/api/auth/webauthn/register-options', { method: 'POST' });
    const attResp = await startRegistration(options);
    const verification = await apiFetch('/api/auth/webauthn/register-verify', { method: 'POST', body: attResp });

    if (verification.verified) {
      const username = localStorage.getItem('last_username') || '';
      if (username) localStorage.setItem('bio_registered_' + username, '1');
      toast('Biometrics Enabled 👆', 'You can now use fingerprint/face to log in next time!', 'success', 4000);
      if (btn) btn.textContent = '✅ Biometrics Active';
    }
  } catch (err) {
    console.error('[biometrics]', err);
    let msg = err.message || 'Unknown error';
    // Friendly messages for common errors
    if (msg.includes('timed out')) msg = 'Timed out — please try again.';
    if (msg.includes('not allowed') || msg.includes('NotAllowedError')) msg = 'Permission denied. Please try again and complete the fingerprint/face scan.';
    if (msg.includes('already registered') || msg.includes('InvalidStateError')) msg = 'This device is already registered. Try logging out and back in.';
    toast('Biometrics Failed', msg, 'error', 6000);
    if (btn) { btn.disabled = false; btn.textContent = '👆 Set Up Biometric Login'; }
  }
}

// ─── RESET BIOMETRICS ─────────────────────────────────────────────────────────
async function resetBiometrics() {
  if (!confirm('This will clear your saved biometric credential. You will need to set it up again.\n\nContinue?')) return;
  try {
    await apiFetch('/api/auth/webauthn/reset', { method: 'POST' });
    const username = localStorage.getItem('last_username') || '';
    if (username) {
      localStorage.removeItem('bio_registered_' + username);
      localStorage.removeItem('prompted_bio_' + username);
    }
    const btn = document.getElementById('bio-setup-btn');
    if (btn) { btn.disabled = false; btn.textContent = '👆 Set Up Biometric Login'; }
    toast('Biometrics Reset', 'You can now set up biometrics again.', 'success');
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

function showReceipt(transactionId, type) {
  const t = window._historyData.find(x => x.id === transactionId && x._type === type);
  if (!t) return;
  
  const date = new Date(t.created_at).toLocaleString();
  const title = type === 'order' ? `${t.product_title} ×${t.quantity}` : `${t.service_name || 'Booking'}`;
  const price = type === 'order' ? t.price * t.quantity : t.service_price || 0;
  
  document.getElementById('receipt-content').innerHTML = `
    <div style="text-align:center; margin-bottom:24px;">
      <h2 style="margin:0; font-size:1.5rem; color:var(--text-primary);">${selectedBiz.name}</h2>
      <div style="color:var(--text-muted); font-size:0.85rem;">Official Receipt</div>
    </div>
    <div style="border-top:1px dashed #ccc; border-bottom:1px dashed #ccc; padding:16px 0; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="color:var(--text-muted)">Date:</span>
        <span style="font-weight:600">${date}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="color:var(--text-muted)">Client:</span>
        <span style="font-weight:600">${t.client_name}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="color:var(--text-muted)">Item:</span>
        <span style="font-weight:600">${title}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="color:var(--text-muted)">Served By:</span>
        <span style="font-weight:600">${t.seller_username || 'Staff'}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="color:var(--text-muted)">Status:</span>
        <span style="font-weight:600; text-transform:uppercase;">${t.status}</span>
      </div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:1.2rem; font-weight:700;">
      <span>TOTAL</span>
      <span>${formatCurrency(price, selectedBiz.currency_symbol)}</span>
    </div>
    <div style="text-align:center; margin-top:32px; font-size:0.75rem; color:var(--text-muted);">
    </div>
  `;
  document.getElementById('receipt-modal').style.display = 'flex';
}

// ─── CHAT ──────────────────────────────────────────────────────────────────────
let activeChatClient = null;

async function openChat(clientId, clientName) {
  activeChatClient = clientId;
  document.getElementById('chat-title').innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5b67f6" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    Chat with ${clientName}
  `;
  document.getElementById('chat-messages').innerHTML = '<div class="spinner"></div>';
  document.getElementById('chat-modal').style.display = 'flex';

  try {
    const messages = await apiFetch(`/api/messages/${selectedBiz.id}/${clientId}`);
    renderChatMessages(messages);
    
    // Mark as read in background
    apiFetch('/api/messages/read', {
      method: 'POST',
      body: { business_id: selectedBiz.id, client_id: clientId }
    }).catch(e => console.error('Failed to mark read', e));
    
  } catch (err) {
    document.getElementById('chat-messages').innerHTML = `<div class="text-red">Failed to load chat: ${err.message}</div>`;
  }
}

function closeChat() {
  document.getElementById('chat-modal').style.display = 'none';
  activeChatClient = null;
}

function renderChatMessages(messages) {
  const container = document.getElementById('chat-messages');
  if (messages.length === 0) {
    container.innerHTML = '<div class="text-dim text-center mt-24">No messages yet. Send a message to start chatting!</div>';
    return;
  }
  container.innerHTML = messages.map(m => {
    const isMe = m.sender === 'seller';
    return `
      <div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}">
        <div style="max-width:80%; padding:10px 14px; border-radius:12px; font-size:0.85rem; ${isMe ? 'background:#5b67f6; color:#fff;' : 'background:#e2e8f0; color:#1a2461;'}">
          ${m.content}
        </div>
        <div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">
          ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>
    `;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// Bind chat form
const chatForm = document.getElementById('chat-form');
if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const content = input.value.trim();
      if (!content || !activeChatClient) return;

      const btn = chatForm.querySelector('button');
      btn.disabled = true;

      try {
        await apiFetch('/api/messages', {
          method: 'POST',
          body: {
            business_id: selectedBiz.id,
            client_id: activeChatClient,
            sender: 'seller',
            content: content
          }
        });
        input.value = '';
        // Re-fetch messages
        const messages = await apiFetch(`/api/messages/${selectedBiz.id}/${activeChatClient}`);
        renderChatMessages(messages);
      } catch (err) {
        toast('Message Error', err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }
  
  // Listen for socket messages
  if (typeof socket !== 'undefined' && socket) {
    socket.on('chat:message', async (msg) => {
      if (activeChatClient && msg.client_id == activeChatClient) {
        const messages = await apiFetch(`/api/messages/${selectedBiz.id}/${activeChatClient}`);
        renderChatMessages(messages);
      } else if (msg.sender === 'client') {
        toast('💬 New Message', `New message from a client`, 'info');
        // Badge the chat tab if visible
        pollPending();
      }
    });
  } else {
    // Socket hasn't been initialized yet, listen for it via event
    window.addEventListener('socket:ready', () => {
      if (socket) {
        socket.on('chat:message', async (msg) => {
          if (activeChatClient && msg.client_id == activeChatClient) {
            const messages = await apiFetch(`/api/messages/${selectedBiz.id}/${activeChatClient}`);
            renderChatMessages(messages);
          } else if (msg.sender === 'client') {
            toast('💬 New Message', `New message from a client`, 'info');
          }
        });
      }
    });
  }
