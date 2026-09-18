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
let currentWeekStart = null;

// Format currency for receipts
function formatCurrency2(amount) {
  if (amount == null) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(amount));
}

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
        <div style="font-size:2rem;margin-bottom:12px"><i data-lucide="alert-triangle" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i></div>
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

  // Dynamically update PWA manifest for this business
  const manifestLink = document.getElementById('dynamic-manifest');
  if (manifestLink) {
    manifestLink.href = `/api/businesses/manifest/${biz.slug}`;
  }

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
  document.getElementById('dashboard-type').innerHTML = type === 'product' ? '<i data-lucide="shopping-bag" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Point of Sale' : type === 'service' ? '<i data-lucide="calendar" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Service Calendar' : '<i data-lucide="shopping-bag" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> POS & <i data-lucide="calendar" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Calendar';

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
  
  if (window.lucide) lucide.createIcons();

  // Show first-login setup prompts if not seen
  setTimeout(showSetupPrompts, 2000);
}

// ─── WIZARD SETUP PROMPTS ──────────────────────────────────────────────────
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

async function showSetupPrompts() {
  const username = localStorage.getItem('last_username');
  if (!username) return;
  
  const needsPush = ('Notification' in window && 'serviceWorker' in navigator && Notification.permission !== 'granted' && !localStorage.getItem('prompted_push_' + username));
  const needsBio = (window.PublicKeyCredential && !localStorage.getItem('bio_registered_' + username) && !localStorage.getItem('prompted_bio_' + username));
  
  if (needsPush || needsBio || deferredPrompt) {
    // Open wizard
    document.getElementById('wiz-step-1').style.display = needsPush ? 'block' : 'none';
    document.getElementById('wiz-step-2').style.display = (!needsPush && needsBio) ? 'block' : 'none';
    document.getElementById('wiz-step-3').style.display = (!needsPush && !needsBio && deferredPrompt) ? 'block' : 'none';
    
    // If none are actually visible (e.g. they skipped earlier), just abort
    if (!needsPush && !needsBio && !deferredPrompt) return;
    
    document.getElementById('onboarding-wizard-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('onboarding-wizard-modal').classList.add('active'), 10);
  } else if ('Notification' in window && Notification.permission === 'granted') {
    enablePushNotifications(true);
  }
}

function wizNextStep(step) {
  document.getElementById('wiz-step-1').style.display = step === 1 ? 'block' : 'none';
  
  const username = localStorage.getItem('last_username');
  const needsBio = (window.PublicKeyCredential && !localStorage.getItem('bio_registered_' + username));
  
  if (step === 2 && !needsBio) {
    step = 3; // Skip bio if not supported or already registered
  }
  
  document.getElementById('wiz-step-2').style.display = step === 2 ? 'block' : 'none';
  
  if (step === 3 && !deferredPrompt) {
    closeModal('onboarding-wizard-modal'); // Skip install if not installable
    return;
  }
  
  document.getElementById('wiz-step-3').style.display = step === 3 ? 'block' : 'none';
}

async function wizEnablePush() {
  const username = localStorage.getItem('last_username');
  localStorage.setItem('prompted_push_' + username, '1');
  await enablePushNotifications();
  wizNextStep(2);
}

function wizEnableBio() {
  const username = localStorage.getItem('last_username');
  localStorage.setItem('prompted_bio_' + username, '1');
  setupBiometrics();
  wizNextStep(3);
}

async function wizInstallApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredPrompt = null;
    }
  }
  closeModal('onboarding-wizard-modal');
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
  
  const qrCode = new QRCodeStyling({
    width: 150,
    height: 150,
    data: clientLink,
    image: biz.logo_url || "",
    dotsOptions: { color: "#1a2461", type: "dots" },
    cornersSquareOptions: { type: "extra-rounded", color: "#1a2461" },
    cornersDotOptions: { type: "dot", color: "#1a2461" },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { crossOrigin: "anonymous", margin: 6 }
  });
  qrCode.append(qrEl);

  // Update TV link
  const tvLink = document.getElementById('tv-display-link');
  if (tvLink) tvLink.href = `/tv.html?slug=${biz.slug}`;

  const modal = document.getElementById('onboarding-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
}

function generateTableQR() {
  const table = document.getElementById('ob-table-num').value.trim();
  if (!table) return toast('Error', 'Enter a table number', 'error');
  
  const clientLink = `${window.location.origin}/c/${selectedBiz.slug}?loc=${encodeURIComponent(table)}`;
  const qrEl = document.getElementById('ob-table-qrcode');
  qrEl.style.display = 'inline-block';
  qrEl.innerHTML = '';
  
  const qrCode = new QRCodeStyling({
    width: 130,
    height: 130,
    data: clientLink,
    image: selectedBiz.logo_url || "",
    dotsOptions: { color: "#1a2461", type: "dots" },
    cornersSquareOptions: { type: "extra-rounded", color: "#1a2461" },
    cornersDotOptions: { type: "dot", color: "#1a2461" },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { crossOrigin: "anonymous", margin: 5 }
  });
  qrCode.append(qrEl);
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
let posServices = [];

async function renderPOS() { setActiveTab('tab-pos');
  const main = document.getElementById('seller-content');
  const tpl = document.getElementById('tpl-pos');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));

  const isService = selectedBiz.type === 'service';

  if (isService) {
    // For service businesses: hide product-only controls
    const addBtn = document.querySelector('.pos-main .btn-outline');
    if (addBtn) addBtn.style.display = 'none';
    const scanBtn = document.querySelector('.pos-main .btn-primary');
    if (scanBtn) scanBtn.style.display = 'none';
    await loadServicesForPOS();
  } else {
    // Re-bind add product form
    const form = document.getElementById('add-product-form');
    if (form) form.addEventListener('submit', addProduct);
    await loadProducts();
  }
}

async function loadServicesForPOS() {
  try {
    posServices = await apiFetch(`/api/services/${selectedBiz.slug}`);
    renderServiceGrid();
  } catch (err) {
    toast('Error', 'Could not load services', 'error');
  }
}

function renderServiceGrid() {
  const grid = document.getElementById('pos-product-grid');
  if (!grid) return;
  if (!posServices.length) {
    grid.innerHTML = `<div class="pos-empty">No services yet. Add services first.</div>`;
    return;
  }
  grid.innerHTML = posServices.map(s => `
    <div class="pos-product-card" onclick="addServiceToCart(${s.id})">
      <div class="pos-product-name">${s.name}</div>
      <div class="pos-product-price">${formatCurrency(s.price)}</div>
      <div class="pos-product-stock" style="color:#64748b;font-size:0.75rem">${s.duration_minutes} min</div>
    </div>
  `).join('');
}

function addServiceToCart(serviceId) {
  const svc = posServices.find(s => s.id === serviceId);
  if (!svc) return;
  if (posCart[serviceId]) {
    posCart[serviceId].qty++;
  } else {
    posCart[serviceId] = { ...svc, qty: 1 };
  }
  renderCart();
}


async function loadProducts() {
  try {
    posProducts = await apiFetch(`/api/products/${selectedBiz.slug}`);
    renderProductGrid();
    checkLowStock();
  } catch (err) {
    toast('Error', 'Could not load products', 'error');
  }
}

function checkLowStock() {
  const threshold = selectedBiz.low_stock_threshold || 10;
  const lowStockItems = posProducts.filter(p => p.stock_quantity <= threshold);
  
  const fab = document.getElementById('fab-lowstock');
  const badge = document.getElementById('fab-lowstock-badge');
  if (fab && badge) {
    if (lowStockItems.length > 0) {
      fab.style.display = 'flex';
      badge.style.display = 'block';
      badge.textContent = lowStockItems.length;
      fab.style.animation = 'pulse 2s infinite';
    } else {
      fab.style.display = 'none';
      fab.style.animation = 'none';
    }
  }
}

// ─── INVENTORY MANAGEMENT ───────────────────────────────────────────────────────
async function renderInventory() {
  setActiveTab("tab-inventory");
  const main = document.getElementById('seller-content');
  const tpl = document.getElementById('tpl-inventory');
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));

  await loadProducts();

  const list = document.getElementById('inventory-list');
  if (!list) return;

  const threshold = selectedBiz.low_stock_threshold || 10;
  
  if (!posProducts.length) {
    list.innerHTML = `<div class="text-dim text-center mt-24">No products found.</div>`;
    return;
  }

  list.innerHTML = posProducts.map(p => {
    const isLow = p.stock_quantity <= threshold;
    const badgeHtml = isLow ? `<span class="badge badge-red ml-8">Low Stock!</span>` : '';
    const imgHtml = p.image_url 
      ? `<img src="${p.image_url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;margin-right:16px;">` 
      : `<div style="width:48px;height:48px;background:#e2e8f0;border-radius:6px;margin-right:16px;display:flex;align-items:center;justify-content:center"><i data-lucide="package" style="color:#94a3b8"></i></div>`;
    
    return `
      <div class="card flex justify-between items-center" style="padding:16px; ${isLow ? 'border:1px solid #fca5a5;background:#fef2f2;' : ''}">
        <div class="flex items-center">
          ${imgHtml}
          <div>
            <div class="font-bold text-lg">${p.title} ${badgeHtml}</div>
            <div class="text-dim text-sm">${p.barcode ? 'Barcode: ' + p.barcode : 'No Barcode'} • Price: ${formatCurrency(p.price)}</div>
          </div>
        </div>
        <div class="flex items-center gap-16">
          <div class="text-right">
            <div class="text-dim text-xs">Current Stock</div>
            <div class="font-bold text-xl ${isLow ? 'text-red' : ''}">${p.stock_quantity}</div>
          </div>
          <button class="btn btn-outline" onclick="openEditStockModal(${p.id}, '${p.title.replace(/'/g, "\\'")}', ${p.stock_quantity})">Update</button>
        </div>
      </div>
    `;
  }).join('');
  
  if (window.lucide) lucide.createIcons();
}

function openEditStockModal(id, title, currentQty) {
  document.getElementById('es-product-id').value = id;
  document.getElementById('edit-stock-product-name').textContent = title;
  document.getElementById('es-stock-qty').value = currentQty;
  openModal('edit-stock-modal');
  
  // Auto-focus input
  setTimeout(() => document.getElementById('es-stock-qty').focus(), 100);
}

document.getElementById('edit-stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('es-product-id').value;
  const qty = document.getElementById('es-stock-qty').value;
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Updating...';

  try {
    await apiFetch(`/api/products/manage/${id}/stock`, {
      method: 'PATCH',
      body: { stock_quantity: qty }
    });
    toast('Success', 'Stock updated successfully', 'success');
    closeModal('edit-stock-modal');
    await loadProducts();
    if (document.getElementById('tab-inventory').classList.contains('btn-primary')) {
      renderInventory();
    }
  } catch (err) {
    toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Update Stock';
  }
});

// Hardware Barcode Scanner Listener
let barcodeBuffer = '';
let barcodeTimeout = null;
document.addEventListener('keydown', (e) => {
  // We want to intercept if we are on the Inventory tab OR the POS tab
  const invTab = document.getElementById('tab-inventory');
  const posTab = document.getElementById('tab-pos');
  
  const isInv = invTab && invTab.classList.contains('btn-primary');
  const isPos = posTab && posTab.classList.contains('btn-primary');

  if (!isInv && !isPos) return;

  // Don't intercept if user is typing in an input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Most hardware scanners simulate keyboard typing very quickly and end with "Enter"
  if (e.key === 'Enter') {
    if (barcodeBuffer.length > 2) { // arbitrary minimum length for a barcode
      handleHardwareBarcodeScan(barcodeBuffer, isPos);
    }
    barcodeBuffer = '';
    return;
  }

  // Only capture single printable characters
  if (e.key.length === 1) {
    barcodeBuffer += e.key;
    // Clear buffer if typing is too slow (human typing vs scanner)
    clearTimeout(barcodeTimeout);
    barcodeTimeout = setTimeout(() => { barcodeBuffer = ''; }, 100); // 100ms timeout
  }
});

function handleHardwareBarcodeScan(barcode, isPos) {
  if (!posProducts || posProducts.length === 0) return;
  const product = posProducts.find(p => p.barcode === barcode);
  
  if (product) {
    if (isPos) {
      toast('Scanned', `Added ${product.title} to cart`, 'success');
      addToCart(product.id);
    } else {
      toast('Scanned', `Found: ${product.title}`, 'info');
      openEditStockModal(product.id, product.title, product.stock_quantity);
    }
  } else {
    toast('Not Found', `No product with barcode ${barcode}`, 'error');
  }
}


function renderProductGrid() {
  const grid = document.getElementById('pos-product-grid');
  if (!grid) return;
  if (!posProducts.length) {
    grid.innerHTML = `<div class="pos-empty">No products yet. Click <strong>+ Add Product</strong> to start.</div>`;
    return;
  }
  grid.innerHTML = posProducts.map(p => {
    const imgHtml = p.image_url 
      ? `<img src="${p.image_url}" alt="${p.title}" style="width:100%; height:120px; object-fit:cover; border-radius:6px; margin-bottom:8px;">` 
      : '';
    return `
    <div class="pos-product-card" onclick="addToCart(${p.id})">
      ${imgHtml}
      <div class="pos-product-name">${p.title}</div>
      <div class="pos-product-price">${formatCurrency(p.price)}</div>
      <div class="pos-product-stock ${p.stock_quantity <= 0 ? 'text-red' : ''}">${p.stock_quantity <= 0 ? '<i data-lucide="x" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Out of Stock' : `${p.stock_quantity} in stock`}</div>
    </div>
    `;
  }).join('');
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

function calculatePOSChange() {
  const totalText = document.getElementById('pos-total-amount').textContent;
  const total = parseFloat(totalText.replace(/[^0-9.-]+/g, '')) || 0;
  const given = parseFloat(document.getElementById('pos-amount-given').value) || 0;
  let change = given - total;
  if (change < 0) change = 0;
  document.getElementById('pos-change-due').textContent = formatCurrency(change);
}

function calculateBookingChange() {
  const total = parseFloat(document.getElementById('complete-final-price').value) || 0;
  const given = parseFloat(document.getElementById('complete-amount-given').value) || 0;
  let change = given - total;
  if (change < 0) change = 0;
  document.getElementById('complete-change-due').textContent = formatCurrency(change);
}

async function checkoutPos() {
  const isService = selectedBiz.type === 'service';
  const items = Object.values(posCart);
  if (!items.length) return;

  const customerName = prompt('Customer name (optional):') || 'Walk-in Customer';

  try {
    let result;
    if (isService) {
      // Walk-in service checkout — create a booking for "now"
      const serviceIdsArray = items.map(i => i.id);
      result = await apiFetch('/api/bookings', {
        method: 'POST',
        body: {
          business_id: selectedBiz.id,
          client_id: null,
          booking_time: new Date().toISOString(),
          service_ids: serviceIdsArray,
        }
      });
      const total = items.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
      result = { items: items.map(i => ({ product: i.name, qty: i.qty, price: i.price })), total };
    } else {
      result = await apiFetch('/api/orders/pos-checkout', {
        method: 'POST',
        body: { business_id: selectedBiz.id, items: items.map(i => ({ product_id: i.id, qty: i.qty })), customer_name: customerName }
      });
    }

    toast('Checkout Complete', `Sale of ${formatCurrency(result.total)} recorded for ${customerName}`, 'success');

    // Generate printable POS receipt PDF
    const element = document.createElement('div');
    element.style.cssText = 'padding:30px;font-family:Arial,sans-serif;color:#000;';
    element.innerHTML = `
      <h1 style="font-size:22px;font-weight:bold;margin-bottom:4px">${selectedBiz.name}</h1>
      <h2 style="font-size:16px;color:#555;margin-bottom:16px">Walk-in Invoice</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      <p><strong>Customer:</strong> ${customerName}</p>
      <hr style="margin:12px 0">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:2px solid #000">
          <th style="text-align:left;padding:6px 0">Item</th>
          <th style="text-align:center;padding:6px 0">Qty</th>
          <th style="text-align:right;padding:6px 0">Total</th>
        </tr></thead>
        <tbody>
          ${result.items.map(i => `
            <tr style="border-bottom:1px solid #ccc">
              <td style="padding:6px 0">${i.product}</td>
              <td style="text-align:center;padding:6px 0">${i.qty}</td>
              <td style="text-align:right;padding:6px 0">${formatCurrency(i.price * i.qty)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="2" style="text-align:right;font-weight:bold;padding:10px 0">TOTAL</td>
          <td style="text-align:right;font-weight:bold;font-size:18px;padding:10px 0">${formatCurrency(result.total)}</td>
        </tr></tfoot>
      </table>
      <div style="text-align:center;margin-top:32px;font-size:11px;color:#888">Powered by Jomish Tech Hub</div>
    `;
    if (typeof html2pdf !== 'undefined') {
      html2pdf().set({ margin:0.5, filename:`invoice_${Date.now()}.pdf`, html2canvas:{scale:2}, jsPDF:{unit:'in',format:'letter'} }).from(element).save();
    }

    posCart = {};
    renderCart();
    if (isService) await loadServicesForPOS(); else await loadProducts();
  } catch (err) {
    toast('Checkout Failed', err.message, 'error');
  }
}

// Camera scanner removed. USB hardware scanner is used instead.

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
    let image_url = null;
    const fileInput = document.getElementById('ap-image');
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      image_url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    const product = await apiFetch('/api/products/manage', {
      method: 'POST',
      body: {
        business_id: selectedBiz.id,
        title: document.getElementById('ap-name').value,
        price: document.getElementById('ap-price').value,
        barcode: document.getElementById('ap-barcode').value,
        stock_quantity: document.getElementById('ap-stock').value,
        image_url
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
          const timeStr = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          const el      = document.createElement('div');

          // Skip lunch break slots — they must not appear on calendar
          if (slot.is_lunch_break) return;

          if (!slot.available && !slot.blocked_by_seller) {
            // Ordered by a client
            el.className = 'cal-slot cal-slot-booked';
            el.innerHTML = `${timeStr} 🔒`;
            el.title     = 'Ordered by client — click for details';
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
    toast('Cancelled', 'Order cancelled and client notified', 'success');
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
    toast(`<i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> New Order — ${data.clientName}`, `${data.productTitle} ×${data.quantity}`, 'info', 8000);
    if (selectedBiz?.type === 'product') loadProducts();
  });

  socket.on('booking:new', (data) => {
    toast(`<i data-lucide="calendar" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> New Order — ${data.clientName}`, `Ordered for ${new Date(data.bookingTime).toLocaleString()}`, 'info', 6000);
    if (selectedBiz?.type === 'service') loadWeek();
  });

  // Also listen for incoming client chat messages
  socket.on('chat:message', async (msg) => {
    // Dispatch a DOM event so the chat modal can react without duplicate socket bindings
    window.dispatchEvent(new CustomEvent('chat:incoming', { detail: msg }));

    if (msg.sender === 'client') {
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
    html += `<button class="btn btn-outline" id="tab-inventory" onclick="renderInventory()">Inventory</button>`;
  }
  if (type === 'service' || type === 'both') {
    html += `<button class="btn btn-outline" id="tab-pos" onclick="renderPOS()">Point of Sale</button>`;
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
      const pendingOrders = await apiFetch(`/api/orders/list/${selectedBiz.slug}?status=pending`);
      const readyOrders = await apiFetch(`/api/orders/list/${selectedBiz.slug}?status=ready`);
      const orders = [...pendingOrders, ...readyOrders];
      orders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // Oldest first
      
      if (orders.length > 0) {
        html += `<h4><i data-lucide="shopping-bag" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Product Orders</h4><div class="list-group mb-24">`;
        
        // Group orders by order_group_id OR client_id + status
        const groupedMap = new Map();
        orders.forEach(o => {
          const key = o.order_group_id || `${o.client_id}-${o.status}`;
          if (!groupedMap.has(key)) {
            groupedMap.set(key, {
              ids: [],
              order_group_id: o.order_group_id,
              client_id: o.client_id,
              client_name: o.client_name,
              client_location: o.client_location,
              table_number: o.table_number,
              payment_method: o.payment_method,
              payment_status: o.payment_status,
              balance_remaining: o.balance_remaining,
              status: o.status,
              created_at: o.created_at,
              items: [],
              total_price: 0
            });
          }
          const group = groupedMap.get(key);
          group.ids.push(o.id);
          group.items.push(`${o.product_title} (x${o.quantity})`);
          group.total_price += parseFloat(o.price || 0) * parseInt(o.quantity || 1);
        });

        html += Array.from(groupedMap.values()).map(g => {
          const isMomo = g.payment_method === 'momo' || g.table_number;
          const tableLabel = g.table_number ? `<span style="background:var(--accent-blue,#3b82f6);color:#fff;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700;letter-spacing:1px;margin-left:6px;">TABLE ${g.table_number}</span>` : '';
          const momoLabel = isMomo ? `<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700;margin-left:6px;">MOMO</span>` : '';
          const payBadge = g.payment_status === 'completed'
            ? `<span style="background:var(--green);color:#fff;padding:2px 8px;border-radius:12px;font-size:0.72rem;margin-left:6px;">PAID ✓</span>`
            : g.payment_status === 'partial'
            ? `<span style="background:#f97316;color:#fff;padding:2px 8px;border-radius:12px;font-size:0.72rem;margin-left:6px;">PARTIAL</span>`
            : '';
          const totalFmt = g.total_price > 0 ? `<span class="text-dim text-sm">Total: <strong>${formatCurrency(g.total_price, selectedBiz.currency_symbol)}</strong>${g.balance_remaining > 0 ? ` · Balance: <strong style="color:#ef4444;">${formatCurrency(g.balance_remaining, selectedBiz.currency_symbol)}</strong>` : ''}</span>` : '';

          const actionButtons = g.status === 'pending'
            ? `
              <button class="btn btn-outline btn-sm" onclick="notifyOrderReady('${g.client_id}', '${g.client_name}', 'Your order')" title="Send Order Ready message"><i data-lucide="bell" class="icon" style="width:1em;height:1em;display:inline-block;vertical-align:middle;"></i> Msg</button>
              <button class="btn btn-primary btn-sm" onclick="markOrderGroupReady('${g.order_group_id}')">Mark Ready</button>
            `
            : isMomo
            ? `
              <button class="btn btn-sm" onclick="handleMomoAction('${g.order_group_id}','RECEIVED')" style="background:var(--green);color:#fff;border:none;font-weight:700;">✓ RECEIVED</button>
              <button class="btn btn-outline btn-sm" onclick="handleMomoAction('${g.order_group_id}','NOT_YET')" title="Minimize order">NOT YET</button>
              <button class="btn btn-outline btn-sm" onclick="handleMomoNotExact('${g.order_group_id}', ${g.balance_remaining || g.total_price})" title="Enter partial amount" style="color:#f59e0b;border-color:#f59e0b;">≠ AMOUNT</button>
            `
            : `<button class="btn btn-success btn-sm" onclick="completeOrderGroup('${g.order_group_id}')" style="background:var(--green);border:none;">Complete / Paid</button>`;

          return `
          <div class="list-item" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
                <strong>${g.client_name}</strong>
                ${tableLabel}${momoLabel}${payBadge}
                ${g.status === 'ready' ? '<span class="badge badge-success ml-4" style="background:var(--green);color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;">READY</span>' : ''}
              </div>
              <div style="margin-top:4px;">
                <span class="text-dim text-sm">${new Date(g.created_at).toLocaleString()}</span>
              </div>
              <ul style="margin:8px 0 4px 16px; font-size:0.9rem;">
                ${g.items.map(item => `<li>${item}</li>`).join('')}
              </ul>
              ${totalFmt}
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; align-items:center; flex-shrink:0;">
              ${actionButtons}
              <button class="btn btn-outline btn-sm" onclick="openChat('${g.client_id}', '${g.client_name}')"><i data-lucide="mail" class="icon" style="width:1em;height:1em;display:inline-block;vertical-align:middle;"></i> Chat</button>
            </div>
          </div>
          `;
        }).join('');
        html += '</div>';
      }
    }
    
    // Load Bookings
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const confirmed = await apiFetch(`/api/bookings/list/${selectedBiz.slug}?status=confirmed`);
      const readyBooks = await apiFetch(`/api/bookings/list/${selectedBiz.slug}?status=ready`);
      const bookings = [...confirmed, ...readyBooks];
      
      const pendingBookings = bookings.filter(b => new Date(b.booking_time) > new Date(Date.now() - 86400000)); // Only show recent/upcoming
      pendingBookings.sort((a, b) => new Date(a.booking_time) - new Date(b.booking_time));
      
      if (pendingBookings.length > 0) {
        html += `<h4><i data-lucide="calendar" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Service Orders</h4><div class="list-group">`;
        html += pendingBookings.map(b => {
          pendingBookingsMap.set(b.id, b);
          return `
          <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${b.service_name || 'Booking'}</strong>
              ${b.status === 'ready' ? '<span class="badge badge-success ml-4" style="background:var(--green);color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;">READY</span>' : ''}
              <br>
              <span class="text-dim text-sm">${b.client_name} ${b.client_location ? `• Table/Loc: ${b.client_location}` : ''} • ${new Date(b.booking_time).toLocaleString()}</span>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-outline btn-sm" onclick="openChat('${b.client_id}', '${b.client_name}')"><i data-lucide="mail" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Chat</button>
              ${b.status !== 'ready' ? `
                <button class="btn btn-primary btn-sm" onclick="markBookingReady(${b.id})">Mark Ready</button>
              ` : `
                <button class="btn btn-success btn-sm" onclick="completeBooking(${b.id})" style="background:var(--green);border:none;">Complete / Paid</button>
              `}
            </div>
          </div>
          `;
        }).join('');
        html += '</div>';
      }
    }
    
    if (!html) html = '<div class="text-dim">No pending items.</div>';
    list.innerHTML = html;
    
  } catch(e) {
    list.innerHTML = `<div class="text-red">Error loading pending items: ${e.message}</div>`;
  }
}

async function notifyOrderReady(clientId, clientName, productTitle) {
  try {
    const msg = `Hi ${clientName}, your order for "${productTitle}" is ready for pickup/delivery!`;
    // Send a chat message to the client
    await apiFetch('/api/messages', {
      method: 'POST',
      body: { 
        business_id: selectedBiz.id, 
        client_id: clientId, 
        sender: 'seller', 
        content: msg
      }
    });
    
    toast('Notified', 'Client has been notified that the order is ready', 'success');
  } catch (err) {
    toast('Error', err.message, 'error');
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
        date: new Date(o.updated_at || o.created_at),
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
        date: new Date(b.updated_at || b.booking_time),
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
          <span class="text-xs" style="color:#94a3b8;">${i.raw.invoice_number || ('#' + i.raw.id)}</span>
        </div>
        <div style="text-align:right">
          <div class="font-bold">${formatCurrency(i.price || 0)}</div>
          <div class="text-xs" style="color:var(--accent-green);font-weight:bold;margin-bottom:6px;">Sold by: ${i.seller || '—'}</div>
          <button class="btn btn-outline" style="padding:6px 14px;font-size:0.78rem;" onclick="showInvoice(${idx})"><i data-lucide="receipt" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Invoice</button>
        </div>
      </div>
    `).join('') + '</div>';
    
  } catch(e) {
    list.innerHTML = `<div class="text-red">Error loading history: ${e.message}</div>`;
  }
}

function showInvoice(idx) {
  const items = window._historyData;
  if (!items || !items[idx]) return;
  const i = items[idx];
  const r = i.raw;
  
  const receiptNum = r.invoice_number || (i.type === 'Product' ? `ORD-${String(r.id).padStart(5,'0')}` : `BKG-${String(r.id).padStart(5,'0')}`);
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

async function markOrderReady(orderId) {
  try {
    await apiFetch(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'ready' }});
    toast('Success', 'Order marked as Ready for collection.', 'success');
    renderPending();
    pollPending();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function markOrderGroupReady(orderGroupId) {
  try {
    if (orderGroupId.includes(',')) {
      // Legacy fallback
      const ids = orderGroupId.split(',');
      await Promise.all(ids.map(id => apiFetch(`/api/orders/${id}/status`, { method: 'PATCH', body: { status: 'ready' }})));
    } else {
      await apiFetch(`/api/orders/group/${orderGroupId}/status`, { method: 'PATCH', body: { status: 'ready' }});
    }
    toast('Success', 'Order marked as Ready for collection.', 'success');
    renderPending();
    pollPending();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function markBookingReady(bookingId) {
  try {
    await apiFetch(`/api/bookings/${bookingId}/status`, { method: 'PATCH', body: { status: 'ready' }});
    toast('Success', 'Service/Booking marked as Ready.', 'success');
    renderPending();
    pollPending();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function completeOrder(orderId) {
  try {
    await apiFetch(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'completed' }});
    toast('Success', 'Order marked as delivered/completed.', 'success');
    renderPending();
    pollPending(); // update badge
    renderPOS(); // Take user to POS
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function completeOrderGroup(orderGroupId) {
  try {
    if (orderGroupId.includes(',')) {
      // Legacy fallback
      const ids = orderGroupId.split(',');
      await Promise.all(ids.map(id => apiFetch(`/api/orders/${id}/status`, { method: 'PATCH', body: { status: 'completed' }})));
    } else {
      await apiFetch(`/api/orders/group/${orderGroupId}/status`, { method: 'PATCH', body: { status: 'completed' }});
    }
    toast('Success', 'Order marked as delivered/completed.', 'success');
    renderPending();
    pollPending(); // update badge
    renderPOS(); // Take user to POS
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

// ─── MoMo / Table Order Action Handlers ───────────────────────────────────────
async function handleMomoAction(orderGroupId, action) {
  try {
    await apiFetch(`/api/orders/group/${orderGroupId}/payment`, {
      method: 'PATCH',
      body: { action }
    });
    if (action === 'RECEIVED') {
      toast('Payment Received', 'Order marked as fully paid and completed.', 'success');
      renderPending();
      pollPending();
    } else if (action === 'NOT_YET') {
      // Just collapse/minimize — re-render pending which will show it as minimized (no special UI needed, just re-render)
      toast('Noted', 'Order is still pending payment.', 'info');
      renderPending();
    }
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function handleMomoNotExact(orderGroupId, currentBalance) {
  const amountStr = window.prompt(`Customer paid partial amount.\nRemaining balance: ${formatCurrency(currentBalance, selectedBiz?.currency_symbol || '')}\n\nEnter amount received:`);
  if (!amountStr) return;
  const amount = parseFloat(amountStr.replace(/[^0-9.]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    toast('Invalid', 'Please enter a valid amount.', 'error');
    return;
  }
  try {
    const res = await apiFetch(`/api/orders/group/${orderGroupId}/payment`, {
      method: 'PATCH',
      body: { action: 'NOT_EXACT_AMOUNT', amountPaid: amount }
    });
    const newBalance = res.balanceRemaining || 0;
    if (newBalance <= 0) {
      toast('Fully Paid', 'Order is now fully paid.', 'success');
    } else {
      toast('Partial Payment', `Balance remaining: ${formatCurrency(newBalance, selectedBiz?.currency_symbol || '')}`, 'info');
    }
    renderPending();
    pollPending();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

let currentBookingToComplete = null;
// Map to store pending bookings for safe lookup (avoids JSON-in-HTML issues)
const pendingBookingsMap = new Map();

function completeBooking(bookingId) {
  const booking = pendingBookingsMap.get(Number(bookingId)) || pendingBookingsMap.get(bookingId);
  if (!booking) {
    toast('Error', 'Order not found. Please refresh and try again.', 'error');
    return;
  }
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

  const btn = document.querySelector('#complete-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

  try {
    await apiFetch(`/api/bookings/${bk.id}/status`, { 
      method: 'PATCH', 
      body: { status: 'completed', final_price: finalPrice }
    });
    
    closeModal('complete-modal');
    toast('Success', 'Order marked as completed.', 'success');
    renderPending();
    pollPending();
    renderPOS(); // Take user to POS
    
    // Send receipt as message to client automatically
    const receiptMsg = [
      `🧭 RECEIPT`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `Business : ${bk.business_name || selectedBiz.name}`,
      `Service  : ${bk.service_name || 'Service'}`,
      `Date     : ${new Date(bk.booking_time).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`,
      `Client   : ${bk.client_name}`,
      `Ref      : ${bk.invoice_number || '#' + bk.id}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `TOTAL    : ${formatCurrency2(finalPrice)}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `Status   : PAID <i data-lucide="check-circle" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>`,
      `Thank you for your visit!`,
    ].join('\n');

    apiFetch('/api/messages', {
      method: 'POST',
      body: {
        business_id: selectedBiz.id,
        client_id: bk.client_id,
        sender: 'seller',
        content: receiptMsg
      }
    }).catch(e => console.warn('Invoice message failed:', e.message));

    // Also generate PDF download
    // generateInvoicePDF(bk, finalPrice); // Auto-download disabled for online orders
  } catch(e) {
    toast('Error', e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Complete & Invoice'; }
  }
}

function generateInvoicePDF(bk, finalPrice) {
  const symbol = selectedBiz?.currency_symbol || '$';
  const logoUrl = selectedBiz?.logo_url || bk.business_logo || '';

  // Populate header
  document.getElementById('receipt-biz-name').textContent = bk.business_name || selectedBiz.name;
  document.getElementById('receipt-biz-location').textContent = bk.business_location || selectedBiz.location || '';
  const phoneEl = document.getElementById('receipt-biz-phone');
  if (phoneEl) phoneEl.textContent = selectedBiz.phone_number || bk.business_phone || '';

  // Logo & watermark images
  const logoEl = document.getElementById('receipt-logo');
  if (logoEl) { logoEl.src = logoUrl; logoEl.style.display = logoUrl ? 'block' : 'none'; }
  const wmEl = document.getElementById('receipt-watermark');
  if (wmEl) { wmEl.src = logoUrl; wmEl.style.display = logoUrl ? 'block' : 'none'; }

  // Order meta
  document.getElementById('receipt-id').textContent = bk.invoice_number || bk.id;
  document.getElementById('receipt-date').textContent = new Date().toLocaleString();
  document.getElementById('receipt-client').textContent = bk.client_name;

  // Line item
  document.getElementById('receipt-service').textContent = bk.service_name || 'Service';
  document.getElementById('receipt-price').textContent = symbol + parseFloat(finalPrice).toFixed(2);
  document.getElementById('receipt-total').textContent = symbol + parseFloat(finalPrice).toFixed(2);

  const element = document.getElementById('receipt-content');
  // Temporarily reveal for html2pdf capture
  const container = document.getElementById('receipt-container');
  container.style.cssText = 'display:block;position:fixed;top:-9999px;left:-9999px;';

  const opt = {
    margin:       0,
    filename:     `Invoice-${bk.invoice_number || bk.id}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true },
    jsPDF:        { unit: 'mm', format: [80, 170], orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    container.style.cssText = 'display:none;position:fixed;top:-9999px;left:-9999px;';
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
  document.getElementById('s-max-clients').value = selectedBiz.max_clients_per_slot || 1;
  document.getElementById('s-low-stock').value = selectedBiz.low_stock_threshold || 10;
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

    // Convert empty strings to null so breaks can be cleared
    const orNull = v => (v && v.trim()) ? v.trim() : null;

    const payload = {
      open_time: document.getElementById('s-open-time').value,
      close_time: document.getElementById('s-close-time').value,
      max_clients_per_slot: document.getElementById('s-max-clients').value || 1,
      low_stock_threshold: document.getElementById('s-low-stock').value || 10,
      lunch_start: orNull(document.getElementById('s-lunch-start').value),
      lunch_end: orNull(document.getElementById('s-lunch-end').value),
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
async function enablePushNotifications(silent = false) {
  const btn = document.getElementById('push-enable-btn');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    if (!silent) toast('Not Supported', 'Push notifications are not supported on this device/browser.', 'error');
    return;
  }
  if (btn && !silent) { btn.disabled = true; btn.innerHTML = '<i data-lucide="hourglass" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Requesting permission…'; }
  try {
    // If already denied, show instructions and bail
    if (Notification.permission === 'denied') {
      if (!silent) toast(
        '<i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Notifications Blocked',
        'To enable: open your browser Settings → Site Settings → Notifications → find this site and set to Allow.',
        'info',
        7000
      );
      if (btn && !silent) { btn.disabled = false; btn.innerHTML = '<i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Enable Push Notifications'; }
      return;
    }

    // Request permission if not yet granted
    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      if (btn && !silent) { btn.disabled = false; btn.innerHTML = '<i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Enable Push Notifications'; }
      return;
    }

    // Get VAPID public key
    const vapidPublicKey = await fetch('/api/push/vapidPublicKey').then(r => r.text());
    if (!vapidPublicKey) throw new Error('Server VAPID key missing');

    const sw = await navigator.serviceWorker.ready;

    // Check if already subscribed with the current key — resubscribe to ensure server has it
    let subscription = await sw.pushManager.getSubscription();
    if (subscription) {
      // Unsubscribe old subscription so we can re-subscribe with current VAPID key
      await subscription.unsubscribe();
    }
    subscription = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });

    // Save subscription to server
    await apiFetch('/api/push/subscribe', { method: 'POST', body: subscription });
    if (!silent) toast('Notifications On! <i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i>', 'You will now receive push notifications for new orders and bookings.', 'success', 4000);
    if (btn) btn.innerHTML = '<i data-lucide="check-circle" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Notifications Enabled';
  } catch (err) {
    if (!silent) toast('Error', err.message, 'error');
    if (btn && !silent) { btn.disabled = false; btn.innerHTML = '<i data-lucide="bell" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Enable Push Notifications'; }
  } finally {
    if (window.lucide) lucide.createIcons();
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
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="hourglass" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Setting up…';
    if (window.lucide) lucide.createIcons();
  }
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
      if (btn) {
        btn.innerHTML = '<i data-lucide="check-circle" class="icon" style="width: 1em; height: 1em; display: inline-block; vertical-align: middle;"></i> Biometrics Active';
        if (window.lucide) lucide.createIcons();
      }
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

function showInvoice(transactionId, type) {
  const t = window._historyData.find(x => x.id === transactionId && x._type === type);
  if (!t) return;
  
  const symbol = selectedBiz?.currency_symbol || '$';
  const logoUrl = selectedBiz?.logo_url || '';
  
  const price = type === 'order' ? t.price * t.quantity : t.service_price || 0;
  const title = type === 'order' ? `${t.product_title} ×${t.quantity}` : `${t.service_name || 'Booking'}`;
  
  // Populate the modern PDF template
  document.getElementById('receipt-biz-name').textContent = selectedBiz.name;
  document.getElementById('receipt-biz-location').textContent = selectedBiz.location || '';
  const phoneEl = document.getElementById('receipt-biz-phone');
  if (phoneEl) phoneEl.textContent = selectedBiz.phone_number || '';
  
  const logoEl = document.getElementById('receipt-logo');
  if (logoEl) { logoEl.src = logoUrl; logoEl.style.display = logoUrl ? 'block' : 'none'; }
  const wmEl = document.getElementById('receipt-watermark');
  if (wmEl) { wmEl.src = logoUrl; wmEl.style.display = logoUrl ? 'block' : 'none'; }
  
  document.getElementById('receipt-id').textContent = t.invoice_number || t.id;
  document.getElementById('receipt-date').textContent = new Date(t.created_at).toLocaleString();
  document.getElementById('receipt-client').textContent = t.client_name || 'Guest';
  
  document.getElementById('receipt-service').textContent = title;
  document.getElementById('receipt-price').textContent = symbol + parseFloat(price).toFixed(2);
  document.getElementById('receipt-total').textContent = symbol + parseFloat(price).toFixed(2);
  
  // Copy to modal
  const contentHtml = document.getElementById('receipt-content').innerHTML;
  document.getElementById('seller-receipt-content').innerHTML = `
    <div style="font-family:'Outfit',Arial,sans-serif;font-size:12px;color:#1a1a2e;position:relative;overflow:hidden;background:#fff;">
      ${contentHtml}
    </div>
  `;
  document.getElementById('seller-receipt-modal').style.display = 'flex';
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
  const modal = document.getElementById('chat-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);

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
  const modal = document.getElementById('chat-modal');
  modal.classList.remove('active');
  setTimeout(() => { modal.style.display = 'none'; }, 200);
  activeChatClient = null;
}

function buildChatMessageHTML(m) {
  const isMe = m.sender === 'seller';
  const isInvoice = m.content && m.content.startsWith('[RECEIPT]');
  const displayContent = isInvoice ? m.content.replace('[RECEIPT]', '<strong>🧾 Invoice</strong>') : m.content;
  const downloadBtn = isInvoice
    ? `<div style="display:flex;gap:8px;margin-top:6px;">
         <button onclick='downloadInvoiceText(${JSON.stringify(m.content)})' style="padding:5px 12px;background:#10b981;color:#fff;border:none;border-radius:8px;font-size:0.75rem;cursor:pointer;">⬇ Download</button>
         <button onclick='printInvoiceText(${JSON.stringify(m.content)})' style="padding:5px 12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:0.75rem;cursor:pointer;">🖨 Print</button>
       </div>`
    : '';
  return `
    <div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}" data-msg-id="${m.id || ''}">
      <div style="max-width:80%; padding:10px 14px; border-radius:12px; font-size:0.85rem; ${isMe ? 'background:#5b67f6; color:#fff;' : 'background:#e2e8f0; color:#1a2461;'}">
        ${displayContent}
        ${downloadBtn}
      </div>
      <div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">
        ${new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
      </div>
    </div>
  `;
}

function downloadInvoiceText(content) {
  const blob = new Blob([content.replace('[RECEIPT] ', '')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invoice_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Downloaded', 'Invoice saved to your device.', 'success');
}

function printInvoiceText(content) {
  const text = content.replace('[RECEIPT] ', '');
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write('<html><head><title>Invoice</title><style>body{font-family:monospace;white-space:pre-wrap;padding:20px;}</style></head><body>' + text + '</body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setTimeout(() => { printWindow.close(); }, 500);
  } else {
    toast('Popup Blocked', 'Please allow popups to print receipts.', 'error');
  }
}

function renderChatMessages(messages) {
  const container = document.getElementById('chat-messages');
  if (messages.length === 0) {
    container.innerHTML = '<div class="text-dim text-center mt-24">No messages yet. Send a message to start chatting!</div>';
    return;
  }
  container.innerHTML = messages.map(m => buildChatMessageHTML(m)).join('');
  container.scrollTop = container.scrollHeight;
}

function appendChatMessage(m) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  // Remove the "no messages" placeholder if present
  const placeholder = container.querySelector('.text-dim');
  if (placeholder) placeholder.remove();
  const div = document.createElement('div');
  div.innerHTML = buildChatMessageHTML(m);
  container.appendChild(div.firstElementChild);
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
        const sent = await apiFetch('/api/messages', {
          method: 'POST',
          body: {
            business_id: selectedBiz.id,
            client_id: activeChatClient,
            sender: 'seller',
            content: content
          }
        });
        input.value = '';
        // Append immediately without re-fetching
        appendChatMessage({ sender: 'seller', content: content, created_at: new Date().toISOString(), id: sent?.id });
      } catch (err) {
        toast('Message Error', err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }
  
  // Listen for real-time socket messages in the chat modal (deduped with top-level listener)
  // The top-level socket listener (set up in initSocket) handles badge updates.
  // This second binding handles appending messages in the open chat window.
  window.addEventListener('chat:incoming', (e) => {
    const msg = e.detail;
    if (activeChatClient && msg.client_id == activeChatClient && msg.sender !== 'seller') {
      appendChatMessage(msg);
    }
  });

// ─── TV DISPLAY MEDIA MANAGER ──────────────────────────────────────────────────
async function openTvMediaManager() {
  if (!selectedBiz) { toast('Error', 'No business selected', 'error'); return; }
  openModal('tv-media-modal');
  await loadTvMediaList();
}

async function loadTvMediaList() {
  const list = document.getElementById('tv-media-list');
  if (!list) return;
  list.innerHTML = '<div class="text-dim text-center" style="padding:24px 0;">Loading…</div>';
  try {
    const items = await apiFetch(`/api/tv-media/${selectedBiz.slug}`);
    if (!items.length) {
      list.innerHTML = '<div class="text-dim text-center" style="padding:32px 0;">No media yet. Add photos, videos or text banners above.</div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const typeIcon = item.type === 'image' ? '🖼️' : item.type === 'video' ? '🎬' : '📝';
      const typeLabel = item.type === 'image' ? 'Image' : item.type === 'video' ? 'Video' : 'Text Banner';
      const preview = item.type === 'image'
        ? `<img src="${item.content}" style="width:80px;height:56px;object-fit:cover;border-radius:6px;flex-shrink:0;" alt="preview">`
        : item.type === 'video'
        ? `<video src="${item.content}" style="width:80px;height:56px;object-fit:cover;border-radius:6px;flex-shrink:0;" muted></video>`
        : `<div style="width:80px;height:56px;border-radius:6px;background:linear-gradient(135deg,#1a2461,#5b67f6);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.3rem;">📝</div>`;
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:10px;">
          ${preview}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.9rem;">${typeIcon} ${item.title || typeLabel}</div>
            ${item.type === 'text' ? `<div class="text-dim text-sm" style="margin-top:2px;white-space:pre-wrap;">${item.content.substring(0, 80)}${item.content.length > 80 ? '…' : ''}</div>` : ''}
            <div class="text-dim" style="font-size:0.75rem;margin-top:3px;">Shows for ${item.duration}s &bull; Order: ${item.sort_order + 1}</div>
          </div>
          <button onclick="deleteTvMedia(${item.id})" style="background:none;border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.8rem;flex-shrink:0;" title="Delete">✕</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="text-red text-center" style="padding:24px 0;">${err.message}</div>`;
  }
}

function tvMediaUpload(type) {
  if (type === 'image') document.getElementById('tv-img-input').click();
  else document.getElementById('tv-vid-input').click();
}

function tvMediaAddText() {
  const form = document.getElementById('tv-text-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function tvMediaHandleFile(event, type) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  const progress = document.getElementById('tv-upload-progress');
  if (progress) progress.style.display = 'block';
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (progress) progress.textContent = `Uploading ${i + 1}/${files.length}: ${file.name}…`;
    try {
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await apiFetch(`/api/tv-media/${selectedBiz.slug}`, {
        method: 'POST',
        body: { type, content, title: file.name.split('.')[0], duration: type === 'image' ? 6 : 30 }
      });
    } catch (err) {
      toast('Upload Failed', `${file.name}: ${err.message}`, 'error');
    }
  }
  
  if (progress) progress.style.display = 'none';
  event.target.value = '';
  toast('Uploaded!', `${files.length} ${type}(s) added to TV display`, 'success');
  await loadTvMediaList();
}

async function tvMediaSaveText() {
  const content = document.getElementById('tv-text-content').value.trim();
  const title   = document.getElementById('tv-text-title').value.trim();
  const duration = parseInt(document.getElementById('tv-text-duration').value) || 8;
  if (!content) { toast('Error', 'Please enter some text', 'error'); return; }
  try {
    await apiFetch(`/api/tv-media/${selectedBiz.slug}`, {
      method: 'POST',
      body: { type: 'text', content, title: title || 'Banner', duration }
    });
    document.getElementById('tv-text-content').value = '';
    document.getElementById('tv-text-title').value = '';
    document.getElementById('tv-text-form').style.display = 'none';
    toast('Added!', 'Text banner added to TV display', 'success');
    await loadTvMediaList();
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

async function deleteTvMedia(id) {
  if (!confirm('Remove this item from the TV display?')) return;
  try {
    await apiFetch(`/api/tv-media/${id}`, { method: 'DELETE' });
    toast('Removed', 'Media item deleted', 'success');
    await loadTvMediaList();
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}
