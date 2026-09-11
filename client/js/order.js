/**
 * Jomish Booking and Delivering Management System — Product Ordering Page Logic
 * Handles: product listing, cart, order placement, Pusher/Socket.io "I'm Waiting"
 */

let business = null;
let client   = null;
let products = [];
let cart     = {}; // { productId: quantity }
let socket   = null;
let orderId  = null;

// ─── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const slug = getParam('slug');
  if (!slug) { renderError('No business slug provided.'); return; }

  injectRegModal();
  setupPwaPrompt();
  renderSkeleton();

  try {
    business = await apiFetch(`/api/businesses/${slug}`);
    Session.setBusiness(business);

    if (business.type !== 'product') {
      window.location.href = `/book.html?slug=${slug}`;
      return;
    }
    document.title = `Order — ${business.name} | Jomish`;
    renderHeader();

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

    showRegistrationModal((c) => {
      client = c;
      loadProducts();
      
      // Show floating chat button once client is registered
      const floatBtn = document.getElementById('float-chat-btn');
      if (floatBtn) floatBtn.style.display = 'flex';
    });
  } catch (err) {
    renderError('Business not found. Check your link and try again.');
  }
});


// ─── Load Products ─────────────────────────────────────────────
async function loadProducts() {
  try {
    products = await apiFetch(`/api/products/${business.slug}`);
    renderProducts();
    initSocket();
  } catch (err) {
    renderError('Could not load products. Please refresh.');
  }
}

// ─── Render ────────────────────────────────────────────────────
function renderHeader() {
  document.getElementById('biz-name').textContent = business.name;
  document.getElementById('biz-badge').textContent = '🛍️ Order Menu';
}

function renderSkeleton() {
  document.getElementById('products-grid').innerHTML = `
    <div class="loading-center"><div class="spinner"></div><p>Loading menu…</p></div>
  `;
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!products.length) {
    grid.innerHTML = `<div class="text-center" style="grid-column:1/-1;padding:48px;color:var(--text-500)">No products available right now.</div>`;
    return;
  }
  grid.innerHTML = products.map(p => {
    const stockClass = p.stock_quantity === 0 ? 'empty' : p.stock_quantity < 5 ? 'low' : '';
    const stockLabel = p.stock_quantity === 0 ? 'Out of Stock' : p.stock_quantity < 5 ? `Only ${p.stock_quantity} left` : `${p.stock_quantity} in stock`;
    const imgHtml = p.image_url
      ? `<img class="product-img" src="${p.image_url}" alt="${p.title}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const emoji = getProductEmoji(p.title);
    return `
      <div class="card product-card" id="prod-${p.id}" onclick="openProductModal(${p.id})" ${p.stock_quantity === 0 ? 'style="opacity:0.5;cursor:not-allowed"' : ''}>
        <span class="product-stock ${stockClass}">${stockLabel}</span>
        ${imgHtml}
        <div class="product-img-placeholder" style="${p.image_url ? 'display:none' : ''}">${emoji}</div>
        <div class="product-title">${p.title}</div>
        <div class="product-desc">${p.description || ''}</div>
        <div class="flex items-center justify-between">
          <div class="product-price">${formatCurrency(p.price, business.currency_symbol)}</div>
          ${cart[p.id] ? `<span class="badge badge-gold">×${cart[p.id]}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function getProductEmoji(title = '') {
  const t = title.toLowerCase();
  if (t.includes('coffee') || t.includes('espresso') || t.includes('latte') || t.includes('cappuccino')) return '☕';
  if (t.includes('tea')) return '🍵';
  if (t.includes('cake') || t.includes('pastry') || t.includes('croissant')) return '🥐';
  if (t.includes('burger')) return '🍔';
  if (t.includes('pizza')) return '🍕';
  if (t.includes('sandwich')) return '🥪';
  if (t.includes('juice') || t.includes('drink')) return '🥤';
  if (t.includes('salad')) return '🥗';
  return '🍽️';
}

// ─── Product Modal ─────────────────────────────────────────────
function openProductModal(id) {
  const p = products.find(x => x.id === id);
  if (!p || p.stock_quantity === 0) return;

  const qty = cart[id] || 1;
  const modal = document.getElementById('product-modal');
  modal.querySelector('#pm-title').textContent = p.title;
  modal.querySelector('#pm-desc').textContent  = p.description || 'No description available.';
  modal.querySelector('#pm-price').textContent = formatCurrency(p.price, business.currency_symbol);
  modal.querySelector('#pm-stock').textContent = `${p.stock_quantity} available`;
  modal.querySelector('#pm-qty').textContent   = qty;
  modal.dataset.productId = id;
  modal.dataset.qty = qty;
  modal.dataset.maxQty = p.stock_quantity;

  updateModalTotal(p.price, qty, business.currency_symbol);
  openModal('product-modal');
}

function changeQty(delta) {
  const modal = document.getElementById('product-modal');
  let qty = parseInt(modal.dataset.qty) + delta;
  const max = parseInt(modal.dataset.maxQty);
  qty = Math.max(1, Math.min(qty, max));
  modal.dataset.qty = qty;
  modal.querySelector('#pm-qty').textContent = qty;
  const p = products.find(x => x.id === parseInt(modal.dataset.productId));
  updateModalTotal(p.price, qty, business.currency_symbol);
}

function updateModalTotal(price, qty, symbol) {
  document.getElementById('pm-total').textContent = `Total: ${formatCurrency(price * qty, symbol)}`;
}

function addToCart() {
  const modal = document.getElementById('product-modal');
  const productId = parseInt(modal.dataset.productId);
  const qty = parseInt(modal.dataset.qty);
  cart[productId] = qty;
  closeModal('product-modal');
  renderProducts();
  updateCartBar();
  toast('Added to cart', `×${qty} item(s) added`, 'success', 2000);
}

// ─── Cart Bar ──────────────────────────────────────────────────
function updateCartBar() {
  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalPrice = Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find(x => x.id === parseInt(id));
    return sum + (p ? p.price * qty : 0);
  }, 0);

  const bar = document.getElementById('cart-bar');
  if (totalItems === 0) {
    bar.classList.remove('visible');
    return;
  }
  bar.classList.add('visible');
  bar.querySelector('#cart-items').textContent = `${totalItems} item${totalItems > 1 ? 's' : ''}`;
  bar.querySelector('#cart-price').textContent = formatCurrency(totalPrice, business.currency_symbol);
}

// ─── Place Order ───────────────────────────────────────────────
async function placeOrder() {
  const btn = document.getElementById('place-order-btn');
  btn.disabled = true;
  btn.textContent = 'Placing order…';

  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  if (!entries.length) { toast('Cart is empty', 'Add items first.', 'error'); btn.disabled = false; return; }

  try {
    // Place each item as a separate order (one product per order row per schema)
    const orderPromises = entries.map(([productId, quantity]) =>
      apiFetch('/api/orders', {
        method: 'POST',
        body: {
          business_id: business.id,
          client_id: client.id,
          product_id: parseInt(productId),
          quantity,
        }
      })
    );
    const orders = await Promise.all(orderPromises);
    orderId = orders[0].id; // Store first order id for notifications

    // Notify seller via Pusher
    await notifySeller(orders);

    cart = {};
    updateCartBar();
    showOrderSuccess(orders);
  } catch (err) {
    toast('Order Failed', err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Confirm Order';
  }
}

async function notifySeller(orders) {
  if (!business.pusher_channel) return;
  try {
    await apiFetch('/api/notify/order', {
      method: 'POST',
      body: {
        channel: business.pusher_channel,
        orderId: orders.map(o => o.id).join(','),
        clientName: client.name,
        productTitle: orders.map(o => `${o.product_title} ×${o.quantity}`).join(', '),
        quantity: orders.reduce((s, o) => s + o.quantity, 0),
      }
    });
  } catch { /* non-critical */ }
}

// ─── Order Success Screen ──────────────────────────────────────
function showOrderSuccess(orders) {
  const orderIds = orders.map(o => o.id);
  const checkStatus = setInterval(async () => {
    try {
      const res = await apiFetch(`/api/orders/list/${business.id}`);
      const myOrders = res.filter(o => orderIds.includes(o.id));
      const allCompleted = myOrders.length > 0 && myOrders.every(o => o.status === 'completed');
      if (allCompleted) {
        clearInterval(checkStatus);
        
        let receiptHtml = '';
        if (myOrders.length) {
          receiptHtml = myOrders.map(o => `
            <div class="flex justify-between mt-8 text-sm">
              <span class="text-dim">${o.product_title} ×${o.quantity}</span>
              <span class="font-bold">${formatCurrency(o.price * o.quantity, business.currency_symbol)}</span>
            </div>
          `).join('');
        }
        
        document.getElementById('main-content').innerHTML = `
          <div class="container-sm" style="padding-top:32px;text-align:center;">
            <div class="success-screen" style="border: 2px solid var(--accent-green);">
              <div class="success-icon" style="background:var(--accent-green);">🎉</div>
              <h2 style="color:var(--accent-green);font-size:2rem;margin-top:16px;">Delivered!</h2>
              <p class="mt-8">Thank you for your order from <strong>${business.name}</strong>.</p>
              
              <div class="card mt-20" style="text-align:left;padding:20px;border:1px solid #e2e8f0;box-shadow:none;">
                <div class="flex justify-between mb-8 text-sm">
                  <span class="text-dim">Order ID</span>
                  <span class="font-bold">#${orderIds.join(', ')}</span>
                </div>
                <hr style="border:none;border-top:1px dashed #e2e8f0;margin:12px 0;">
                ${receiptHtml}
                <hr style="border:none;border-top:1px dashed #e2e8f0;margin:12px 0;">
                <div class="flex justify-between mt-8 text-sm">
                  <span class="text-dim font-bold">Status</span>
                  <span class="badge badge-green">Completed ✓</span>
                </div>
              </div>
              
              <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;justify-content:center">
                <button class="btn btn-primary" onclick="downloadOrderReceipt('${orderIds.join(',')}')">📥 Download Receipt</button>
                <button class="btn btn-outline" onclick="window.location.reload()">Place Another</button>
              </div>
            </div>
          </div>
        `;
        showPwaPromptIfAvailable();
      }
    } catch (e) {}
  }, 5000);

  const summary = orders.map(o =>
    `<div class="flex justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--glass-border)">
      <span>${o.product_title} ×${o.quantity}</span>
      <span class="text-gold">${formatCurrency(o.price * o.quantity, business.currency_symbol)}</span>
    </div>`
  ).join('');

  document.getElementById('main-content').innerHTML = `
    <div class="container-sm" style="padding-top:32px">
      <div class="success-screen">
        <div class="success-icon">✓</div>
        <h2>Order Placed!</h2>
        <p class="mt-8">Your order has been sent to ${business.name}.</p>
        <div class="card mt-20" style="text-align:left;padding:20px">
          <h3 style="margin-bottom:14px">Order Summary</h3>
          ${summary}
        </div>
        <button class="btn btn-primary btn-lg mt-20 pulse" id="waiting-btn" onclick="iAmWaiting()">
          🔔 I'm Waiting — Notify Seller
        </button>
        <div class="mt-20">
          <h3 style="margin-bottom:12px">Chat with ${business.name}</h3>
          <div id="chat-container"></div>
        </div>
        <button class="btn btn-outline mt-20" onclick="window.location.reload()">Place Another Order</button>
      </div>
    </div>
  `;
  initChat('chat-container');
}

// ─── "I'm Waiting" Button ──────────────────────────────────────
async function iAmWaiting() {
  const btn = document.getElementById('waiting-btn');
  btn.disabled = true;
  btn.classList.remove('pulse');
  btn.textContent = '✓ Seller Notified!';

  // Emit via socket (in addition to Pusher already fired)
  if (socket) {
    socket.emit('order:waiting', {
      businessId: business.id,
      clientName: client.name,
      orderId,
    });
  }
  toast('Seller Notified', 'Your seller has been alerted you\'re waiting.', 'success');
}

// ─── Socket.io ─────────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') return;
  socket = io();
  // Join seller notifications room isn't needed client-side; just for chat
}

// ─── Chat ──────────────────────────────────────────────────────
let chatLoaded = false;
async function initChat(containerId) {
  if (chatLoaded) return;
  chatLoaded = true;

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

  // Load history
  try {
    const msgs = await apiFetch(`/api/messages/${business.id}/${client.id}`);
    msgs.forEach(renderMsg);
  } catch { /* no history yet */ }

  // Connect socket
  if (!socket) { socket = io(); }
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
  const input = document.getElementById('chat-input');
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

function renderError(msg) {
  document.getElementById('main-content').innerHTML = `
    <div class="loading-center" style="padding:80px">
      <div style="font-size:2.5rem">⚠️</div>
      <h2 style="margin-top:12px">Something went wrong</h2>
      <p>${msg}</p>
    </div>
  `;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── STANDALONE FLOATING CHAT (available anytime) ──────────────────────────────
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
  
  // Optimistic render
  renderClientChatMsg({ sender: 'client', content, created_at: new Date().toISOString() });
  input.value = '';
  
  try {
    const msg = await apiFetch('/api/messages', {
      method: 'POST',
      body: { business_id: business.id, client_id: client.id, sender: 'client', content }
    });
    // We already rendered it, so we don't call renderClientChatMsg here again.
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
      <div style="font-size:0.78rem;opacity:0.85">Add to your home screen for faster ordering and notifications</div>
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

// ─── RECEIPT DOWNLOAD ──────────────────────────────────────────────────────────
async function downloadOrderReceipt(orderIdsStr) {
  try {
    const res = await apiFetch(`/api/orders/list/${business.id}`);
    const ids = orderIdsStr.split(',').map(Number);
    const myOrders = res.filter(o => ids.includes(o.id));
    
    let total = 0;
    const itemsLines = myOrders.map(o => {
      const lineTotal = o.price * o.quantity;
      total += lineTotal;
      return `- ${o.product_title} ×${o.quantity} : ${formatCurrency(lineTotal, business.currency_symbol)}`;
    }).join('\n');

    const lines = [
      '=============================',
      '       JOMISH ORDER          ',
      '       RECEIPT               ',
      '=============================',
      `Business  : ${business.name}`,
      `Client    : ${client.name}`,
      `Order IDs : #${orderIdsStr}`,
      `Date      : ${new Date().toLocaleString()}`,
      '-----------------------------',
      'ITEMS:',
      itemsLines,
      '-----------------------------',
      `TOTAL     : ${formatCurrency(total, business.currency_symbol)}`,
      '=============================',
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `Jomish-Order-${ids[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast('Error', 'Failed to generate receipt', 'error');
  }
}
