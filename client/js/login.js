/**
 * Jomish Login Logic
 *
 * Flow:
 * 1. Page loads → show the standard login form immediately (always visible).
 *    If a saved username + biometric flag exists, also show a "fast login" card BELOW the form.
 *    - User taps fast-login button → biometric prompt
 *    - Success → log in automatically
 *    - Fail / declined → fast-login card hides, form remains fully usable
 * 2. User submits username+password → log in
 *    - On success → silently register biometrics (device native prompt)
 */

const { startAuthentication, startRegistration } = SimpleWebAuthnBrowser;

// ─── IndexedDB helpers for persistent biometric state ────────────────────────
const BioStore = {
  DB_NAME: 'jomish_bio',
  STORE:   'flags',

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this.STORE);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async get(key) {
    try {
      const db = await this._open();
      return new Promise((resolve) => {
        const tx = db.transaction(this.STORE, 'readonly');
        const req = tx.objectStore(this.STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(null);
      });
    } catch { return null; }
  },

  async set(key, value) {
    try {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE, 'readwrite');
        tx.objectStore(this.STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror    = e => reject(e.target.error);
      });
    } catch (e) { console.warn('[BioStore] set failed:', e); }
  },
};

window.addEventListener('DOMContentLoaded', async () => {
  // Always initialize password toggle first
  pwEye('password');

  // Check IndexedDB for saved username (survives cache clears)
  const idbUser  = await BioStore.get('last_username');
  const lsUser   = localStorage.getItem('last_username');
  const lastUser = idbUser || lsUser;

  // Migrate localStorage to IndexedDB if needed
  if (lsUser && !idbUser) await BioStore.set('last_username', lsUser);

  if (lastUser) {
    // Pre-fill username field
    const usernameEl = document.getElementById('username');
    if (usernameEl) usernameEl.value = lastUser;

    // Check if biometrics are registered for this user
    const bioFlag = await BioStore.get('bio_registered_' + lastUser)
                 || localStorage.getItem('bio_registered_' + lastUser);

    if (bioFlag) {
      // Show the fast-login card (form stays visible above it)
      const fastUi = document.getElementById('fast-login-ui');
      if (fastUi) {
        const bizName = localStorage.getItem('business_name');
        const nameEl  = document.getElementById('fast-login-name');
        if (nameEl) {
          nameEl.textContent = bizName ? 'Welcome back to ' + bizName : 'Welcome back, ' + lastUser;
        }
        fastUi.style.display = 'block';
      }
    }
  }

  // Force uppercase while typing
  const usernameInput = document.getElementById('username');
  if (usernameInput) {
    usernameInput.addEventListener('input', function () {
      const pos = this.selectionStart;
      this.value = this.value.toUpperCase();
      this.setSelectionRange(pos, pos);
    });
  }

  // Standard password login submit
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username) { toast('Required', 'Please enter your User ID', 'error'); return; }
    if (!password) { toast('Required', 'Please enter your password', 'error'); return; }

    btn.disabled    = true;
    btn.textContent = 'Signing in...';

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });

      handleLoginSuccess(data);

      // After successful password login, silently try to register biometrics
      if (!(await BioStore.get('bio_registered_' + username))
          && !localStorage.getItem('bio_registered_' + username)) {
        setTimeout(() => attemptBiometricRegistration(username), 1500);
      }

    } catch (err) {
      toast('Login Failed', err.message, 'error');
      btn.disabled    = false;
      btn.textContent = 'Sign In';
    }
  });
});

// ─── FAST LOGIN (triggered by button tap) ─────────────────────────────────────
async function triggerFastLogin() {
  const idbUser  = await BioStore.get('last_username');
  const lastUser = idbUser || localStorage.getItem('last_username');
  if (!lastUser) { showNormalLogin(); return; }

  const btn = document.getElementById('fast-login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

  try {
    await attemptBiometricLogin(lastUser);
  } catch (_) {
    // fall through — attemptBiometricLogin handles its own fallback
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Sign In with Biometrics'; }
}

function showNormalLogin() {
  const fastUi = document.getElementById('fast-login-ui');
  if (fastUi) fastUi.style.display = 'none';
  const usernameEl = document.getElementById('username');
  if (usernameEl) usernameEl.focus();
}

// ─── BIOMETRIC LOGIN ──────────────────────────────────────────────────────────
async function attemptBiometricLogin(username) {
  const spinner = document.getElementById('bio-attempting');
  if (spinner) spinner.style.display = 'block';

  try {
    const options = await apiFetch('/api/auth/webauthn/auth-options', {
      method: 'POST',
      body: { username }
    });

    const asseResp = await startAuthentication(options);

    const verification = await apiFetch('/api/auth/webauthn/auth-verify', {
      method: 'POST',
      body: { username, response: asseResp }
    });

    if (verification.verified) {
      handleLoginSuccess(verification);
      return;
    }
  } catch (err) {
    console.warn('[Biometric] login failed:', err.message);
  }

  if (spinner) spinner.style.display = 'none';
}

// ─── BIOMETRIC REGISTRATION (silent, after first password login) ──────────────
async function attemptBiometricRegistration(username) {
  if (!window.PublicKeyCredential) return;

  try {
    const options = await apiFetch('/api/auth/webauthn/register-options', {
      method: 'POST'
    });

    const attResp = await startRegistration(options);

    const verification = await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: attResp
    });

    if (verification.verified) {
      await BioStore.set('bio_registered_' + username, '1');
      localStorage.setItem('bio_registered_' + username, '1');
      toast('Biometrics Enabled', 'Next time, sign in with one tap!', 'success', 4000);
    }
  } catch (err) {
    // Declined or not supported — fail silently
  }
}

// ─── SUCCESS HANDLER ──────────────────────────────────────────────────────────
function handleLoginSuccess(data) {
  localStorage.setItem('auth_token',  data.token);
  localStorage.setItem('last_username', data.seller.username);
  localStorage.setItem('role',        data.seller.role);
  BioStore.set('last_username', data.seller.username);

  if (data.has_biometrics) {
    localStorage.setItem('bio_registered_' + data.seller.username, '1');
    BioStore.set('bio_registered_' + data.seller.username, '1');
  }
  if (data.business_slug) {
    localStorage.setItem('business_slug', data.business_slug);
  }
  if (data.business_name) {
    localStorage.setItem('business_name', data.business_name);
  }
  if (data.seller.is_demo) {
    localStorage.setItem('is_demo', '1');
  } else {
    localStorage.removeItem('is_demo');
  }

  setTimeout(() => {
    if (data.seller.role === 'tech') {
      window.location.href = '/tech.html';
    } else {
      window.location.href = '/seller.html';
    }
  }, 300);
}

// ─── DEMO LOGIN ───────────────────────────────────────────────────────────────
async function demoLogin(type) {
  try {
    const btn = event && event.target ? event.target.closest('button') : null;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    const data = await apiFetch('/api/auth/demo-login', { method: 'POST', body: { type } });
    handleLoginSuccess(data);
  } catch (err) {
    toast('Demo Error', err.message || 'Could not start demo. Try again.', 'error');
    document.querySelectorAll('[onclick^="demoLogin"]').forEach(b => { b.disabled = false; b.style.opacity = '1'; });
  }
}
