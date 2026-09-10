/**
 * Jomish Booking System — Shared App Utilities
 * Router, LocalStorage session, API wrapper, Toast notifications
 */

// ─── API Base URL ──────────────────────────────────────────────
const API = window.location.origin;

// ─── Session Management (LocalStorage) ────────────────────────
const Session = {
  KEY: 'jomish_client',
  BIZ_KEY: 'jomish_business',

  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; }
  },
  set(client) {
    localStorage.setItem(this.KEY, JSON.stringify(client));
  },
  clear() {
    localStorage.removeItem(this.KEY);
  },
  getBusiness() {
    try { return JSON.parse(localStorage.getItem(this.BIZ_KEY)); } catch { return null; }
  },
  setBusiness(biz) {
    localStorage.setItem(this.BIZ_KEY, JSON.stringify(biz));
  }
};

// ─── API Fetch Wrapper ─────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    console.error('[API]', path, err.message);
    throw err;
  }
}

// ─── Toast Notifications ───────────────────────────────────────
function toast(title, body = '', type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div class="toast-title">${title}</div>
    ${body ? `<div class="toast-body">${body}</div>` : ''}
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ─── Modal Helper ─────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

// ─── Format Helpers ────────────────────────────────────────────
function formatTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatDateTime(isoStr) {
  return `${formatDate(isoStr)} · ${formatTime(isoStr)}`;
}
function formatCurrency(amount, symbol = '$') {
  return `${symbol}${parseFloat(amount).toFixed(2)}`;
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Page Router (used by index.html) ─────────────────────────
function routeToPage() {
  const path = window.location.pathname;
  if (path.startsWith('/order/')) {
    window.location.href = `/order.html?slug=${path.split('/order/')[1]}`;
  } else if (path.startsWith('/book/')) {
    window.location.href = `/book.html?slug=${path.split('/book/')[1]}`;
  } else if (path === '/seller') {
    window.location.href = '/seller.html';
  }
}

// ─── URL Params Helper ─────────────────────────────────────────
function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

// ─── Registration Modal (shared between order & book pages) ───
async function showRegistrationModal(onSuccess) {
  const client = Session.get();
  if (client) { onSuccess(client); return; }

  openModal('reg-modal');

  document.getElementById('reg-form').onsubmit = async (e) => {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value.trim();
    const location = document.getElementById('reg-location').value.trim();
    const photoFile = document.getElementById('reg-photo').files[0];

    if (!name || !location) { toast('Missing Info', 'Name and location are required.', 'error'); return; }

    const btn = document.getElementById('reg-submit');
    btn.disabled = true;
    btn.textContent = 'Registering…';

    try {
      // Convert photo to base64 if provided (simple demo approach)
      let photo_url = null;
      if (photoFile) {
        photo_url = await fileToBase64(photoFile);
      }
      const client = await apiFetch('/api/clients', {
        method: 'POST',
        body: { name, location, photo_url }
      });
      Session.set(client);
      closeModal('reg-modal');
      toast('Welcome!', `Hi ${client.name} 👋`, 'success');
      onSuccess(client);
    } catch (err) {
      toast('Registration Failed', err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Get Started →';
    }
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Registration Modal HTML (injected dynamically) ───────────
function injectRegModal() {
  if (document.getElementById('reg-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="reg-modal">
      <div class="modal">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <div class="brand-icon">🧾</div>
          <span style="font-family:Outfit,sans-serif;font-weight:800;font-size:1.1rem;">Jomish</span>
        </div>
        <h2 class="modal-title mt-12">Quick Registration</h2>
        <p class="modal-sub">Just a few details and you're ready to order.</p>
        <form id="reg-form">
          <div class="form-group">
            <label for="reg-name">Your Name</label>
            <input type="text" id="reg-name" placeholder="e.g. Alex Johnson" required autocomplete="name">
          </div>
          <div class="form-group">
            <label for="reg-location">Your Location / Address</label>
            <input type="text" id="reg-location" placeholder="e.g. Table 4 or 123 Main St" required>
          </div>
          <div class="form-group">
            <label for="reg-photo">Profile Photo <span style="color:var(--text-500);font-weight:400;">(optional)</span></label>
            <input type="file" id="reg-photo" accept="image/*">
          </div>
          <button type="submit" class="btn btn-gold btn-full mt-8" id="reg-submit">Get Started →</button>
        </form>
      </div>
    </div>
  `);
}
