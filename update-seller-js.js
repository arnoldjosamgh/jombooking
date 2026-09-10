const fs = require('fs');

let js = fs.readFileSync('client/js/seller.js', 'utf8');

// Replace setupBiz to include tabs
const oldSetup = `function setupBiz(biz) {
  selectedBiz = biz;
  document.getElementById('no-biz').style.display = 'none';
  document.getElementById('seller-content').style.display = 'block';
  document.getElementById('dashboard-title').textContent = biz.name;

  if (biz.logo_url) {
    const brandIconContainer = document.querySelector('.brand-icon');
    if (brandIconContainer) {
      brandIconContainer.innerHTML = \`<img src="\${biz.logo_url}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:10px">\`;
    }
  }

  const type = biz.type;
  document.getElementById('dashboard-type').textContent = type === 'product' ? '🛍️ Point of Sale' : '📅 Service Calendar';

  if (type === 'product' || type === 'both') {
    renderPOS();
  } else {
    renderCalendar();
  }

  initSocket(biz);
  checkFirstLogin(biz);
}`;

const newSetup = `function setupBiz(biz) {
  selectedBiz = biz;
  document.getElementById('no-biz').style.display = 'none';
  document.getElementById('seller-content').style.display = 'block';
  document.getElementById('dashboard-title').textContent = biz.name;

  if (biz.logo_url) {
    const brandIconContainer = document.querySelector('.brand-icon');
    if (brandIconContainer) {
      brandIconContainer.innerHTML = \`<img src="\${biz.logo_url}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:10px">\`;
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
}`;

if (js.includes(oldSetup)) {
  js = js.replace(oldSetup, newSetup);
}

// Append new functions if they don't exist
if (!js.includes('function renderTabs')) {
  js += `

// ─── TABS & HISTORY & PENDING ───────────────────────────────────────────────

function renderTabs(type) {
  const tabs = document.getElementById('seller-tabs');
  tabs.style.display = 'flex';
  
  let html = '';
  if (type === 'product' || type === 'both') {
    html += \`<button class="btn btn-outline" id="tab-pos" onclick="renderPOS()">Point of Sale</button>\`;
  }
  if (type === 'service' || type === 'both') {
    html += \`<button class="btn btn-outline" id="tab-calendar" onclick="renderCalendar()">Calendar</button>\`;
  }
  html += \`<button class="btn btn-outline" id="tab-pending" onclick="renderPending()">Pending</button>\`;
  html += \`<button class="btn btn-outline" id="tab-history" onclick="renderHistory()">History</button>\`;
  
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
      const orders = await apiFetch(\`/api/orders/list/\${selectedBiz.slug}?status=pending\`);
      if (orders.length > 0) {
        html += \`<h4>🛍️ Product Orders</h4><div class="list-group mb-24">\`;
        html += orders.map(o => \`
          <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>\${o.product_title}</strong> (x\${o.quantity})<br>
              <span class="text-dim text-sm">\${o.client_name} • \${new Date(o.created_at).toLocaleString()}</span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="completeOrder(\${o.id})">Mark Delivered</button>
          </div>
        \`).join('');
        html += '</div>';
      }
    }
    
    // Load Bookings
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const bookings = await apiFetch(\`/api/bookings/list/\${selectedBiz.slug}?status=confirmed\`);
      const pendingBookings = bookings.filter(b => new Date(b.booking_time) > new Date(Date.now() - 86400000)); // Only show recent/upcoming
      if (pendingBookings.length > 0) {
        html += \`<h4>📅 Service Bookings</h4><div class="list-group">\`;
        html += pendingBookings.map(b => \`
          <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>\${b.service_name || 'Booking'}</strong><br>
              <span class="text-dim text-sm">\${b.client_name} • \${new Date(b.booking_time).toLocaleString()}</span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="completeBooking(\${b.id})">Mark Completed</button>
          </div>
        \`).join('');
        html += '</div>';
      }
    }
    
    if (!html) html = '<div class="text-dim">No pending items.</div>';
    list.innerHTML = html;
    
  } catch(e) {
    list.innerHTML = \`<div class="text-red">Error loading pending items: \${e.message}</div>\`;
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
      const orders = await apiFetch(\`/api/orders/list/\${selectedBiz.slug}?status=completed\`);
      items = items.concat(orders.map(o => ({
        type: 'Product',
        title: \`\${o.product_title} (x\${o.quantity})\`,
        client: o.client_name,
        date: new Date(o.created_at),
        seller: o.seller_username || 'Unknown',
        price: o.total_price
      })));
    }
    
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const bookings = await apiFetch(\`/api/bookings/list/\${selectedBiz.slug}?status=completed\`);
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
    
    list.innerHTML = \`<div class="list-group">\` + items.map(i => \`
      <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>\${i.title}</strong> <span class="badge" style="background:#e2e8f0;color:#475569;font-size:0.7rem">\${i.type}</span><br>
          <span class="text-dim text-sm">Client: \${i.client} • \${i.date.toLocaleString()}</span>
        </div>
        <div style="text-align:right">
          <div class="font-bold">\${formatCurrency(i.price || 0)}</div>
          <div class="text-xs" style="color:var(--accent-green);font-weight:bold;">Sold by: \${i.seller}</div>
        </div>
      </div>
    \`).join('') + '</div>';
    
  } catch(e) {
    list.innerHTML = \`<div class="text-red">Error loading history: \${e.message}</div>\`;
  }
}

async function completeOrder(orderId) {
  try {
    await apiFetch(\`/api/orders/\${orderId}/status\`, { method: 'PATCH', body: { status: 'completed' }});
    toast('Success', 'Order marked as delivered/completed.', 'success');
    renderPending();
    pollPending(); // update badge
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function completeBooking(bookingId) {
  try {
    await apiFetch(\`/api/bookings/\${bookingId}/status\`, { method: 'PATCH', body: { status: 'completed' }});
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
      const orders = await apiFetch(\`/api/orders/list/\${selectedBiz.slug}?status=pending\`);
      count += orders.length;
    }
    if (selectedBiz.type === 'service' || selectedBiz.type === 'both') {
      const bookings = await apiFetch(\`/api/bookings/list/\${selectedBiz.slug}?status=confirmed\`);
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
      if(tab) tab.innerHTML = \`Pending <span style="background:red;color:white;border-radius:50%;padding:2px 6px;font-size:0.7rem;margin-left:4px;">\${count}</span>\`;
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
`;

}

// Fix renderPOS and renderCalendar to set active tab
const oldRenderPOS = `function renderPOS() {`;
const oldRenderCalendar = `function renderCalendar() {`;

if (js.includes('async function renderPOS() {')) {
  js = js.replace('async function renderPOS() {', 'async function renderPOS() { setActiveTab("tab-pos");');
} else if (js.includes('function renderPOS() {')) {
  js = js.replace('function renderPOS() {', 'function renderPOS() { setActiveTab("tab-pos");');
}

if (js.includes('async function renderCalendar() {')) {
  js = js.replace('async function renderCalendar() {', 'async function renderCalendar() { setActiveTab("tab-calendar");');
} else if (js.includes('function renderCalendar() {')) {
  js = js.replace('function renderCalendar() {', 'function renderCalendar() { setActiveTab("tab-calendar");');
}

fs.writeFileSync('client/js/seller.js', js);
console.log('seller.js updated with tab logic.');
