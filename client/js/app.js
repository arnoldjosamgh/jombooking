/**
 * Jomish Booking and Delivering Management System — Shared App Utilities
 * Router, LocalStorage session, API wrapper, Toast notifications
 */

// ─── Dark / Night Mode ─────────────────────────────────────────
// Applied immediately (before DOMContentLoaded) to prevent flash
(function applyTheme() {
  const saved = localStorage.getItem('jomish_theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
})();

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('jomish_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('jomish_theme', 'dark');
  }
  updateDarkToggleIcon();
}

function updateDarkToggleIcon() {
  const btn = document.getElementById('dark-mode-toggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Night Mode';
}

// Inject the floating dark toggle button into every page
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('dark-mode-toggle')) {
    const btn = document.createElement('button');
    btn.id = 'dark-mode-toggle';
    btn.className = 'dark-toggle';
    btn.onclick = toggleDarkMode;
    document.body.appendChild(btn);
    updateDarkToggleIcon();
  }
});

// ─── Password Eye Toggle Helper ────────────────────────────────
// Call pwEye(inputId) to wrap any password input with show/hide
function pwEye(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.parentElement.classList.contains('pw-wrapper')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'pw-wrapper';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  btn.setAttribute('aria-label', 'Toggle password visibility');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  btn.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  };
  wrapper.appendChild(btn);
}

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
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'flex';
  setTimeout(() => el.classList.add('active'), 10);
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active');
  setTimeout(() => el.style.display = 'none', 200);
}

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
          <button type="submit" class="btn btn-primary btn-full mt-8" id="reg-submit">Get Started →</button>
        </form>
      </div>
    </div>
  `);
}
