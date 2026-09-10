/**
 * Jomish Booking System — Product Ordering Page Logic
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

    showRegistrationModal((c) => {
      client = c;
      loadProducts();
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
        <button class="btn btn-gold btn-lg mt-20 pulse" id="waiting-btn" onclick="iAmWaiting()">
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
