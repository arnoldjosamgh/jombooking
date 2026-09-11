/**
 * Jomish Login Logic
 *
 * Flow:
 * 1. Page loads → if last_username is stored, silently attempt biometric auth
 *    - Success → log in automatically (no password needed)
 *    - Fail / not available / declined → hide spinner, show normal form
 * 2. User submits username+password → log in
 *    - On success → trigger biometric registration in background (device prompt appears)
 *    - If they decline or device doesn't support it → no problem, just continue
 */

const { startAuthentication, startRegistration } = SimpleWebAuthnBrowser;

window.addEventListener('DOMContentLoaded', async () => {
  const lastUser = localStorage.getItem('last_username');

  // Initialize password toggle
  pwEye('password');

  if (lastUser) {
    // Pre-fill the username so the form is ready if biometrics fail
    document.getElementById('username').value = lastUser;

    // Show biometric button if user previously registered biometrics
    if (localStorage.getItem('bio_registered_' + lastUser)) {
      const bioSection = document.getElementById('bio-login-section');
      if (bioSection) bioSection.style.display = 'block';
      // Also silently attempt biometric login on page load
      await attemptBiometricLogin(lastUser);
    }
  }

  // Force uppercase while typing — update bio button visibility on change
  document.getElementById('username').addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(pos, pos);
    const bioSection = document.getElementById('bio-login-section');
    if (bioSection) {
      bioSection.style.display = localStorage.getItem('bio_registered_' + this.value) ? 'block' : 'none';
    }
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });

      handleLoginSuccess(data);

      // After successful password login, silently try to register biometrics
      // (only if not already registered for this user)
      if (!localStorage.getItem('bio_registered_' + username)) {
        setTimeout(() => attemptBiometricRegistration(username), 1500);
      }

    } catch (err) {
      toast('Login Failed', err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
});

// Manual biometric login trigger (button tap)
async function triggerBiometricLogin() {
  const username = document.getElementById('username').value.trim();
  if (!username) {
    toast('Enter Username', 'Please type your username first', 'error');
    return;
  }
  const btn = document.getElementById('bio-login-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  await attemptBiometricLogin(username);
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}

// ─── SILENT BIOMETRIC LOGIN ────────────────────────────────────────────────────
async function attemptBiometricLogin(username) {
  // Show the subtle spinner
  const spinner = document.getElementById('bio-attempting');
  const form    = document.getElementById('login-form');
  const msg     = document.getElementById('login-msg');

  spinner.style.display = 'block';
  form.style.opacity = '0.4';
  form.style.pointerEvents = 'none';
  if (msg) msg.style.display = 'none';

  try {
    const options = await apiFetch('/api/auth/webauthn/auth-options', {
      method: 'POST',
      body: { username }
    });

    // Device-level prompt (FaceID / TouchID / Windows Hello / fingerprint)
    const asseResp = await startAuthentication(options);

    const verification = await apiFetch('/api/auth/webauthn/auth-verify', {
      method: 'POST',
      body: { username, response: asseResp }
    });

    if (verification.verified) {
      handleLoginSuccess(verification);
      return; // Done — user never saw the form
    }
  } catch (err) {
    // Biometrics not set up, declined, or failed — silently fall back to form
    // No toast, no error message — just show the login form normally
  }

  // Show form again
  spinner.style.display = 'none';
  form.style.opacity = '1';
  form.style.pointerEvents = 'auto';
  if (msg) msg.style.display = 'block';
}

// ─── SILENT BIOMETRIC REGISTRATION (after 1st password login) ─────────────────
async function attemptBiometricRegistration(username) {
  // Only attempt if the browser supports it
  if (!window.PublicKeyCredential) return;

  try {
    const options = await apiFetch('/api/auth/webauthn/register-options', {
      method: 'POST'
    });

    // Device-level prompt — user sees their device's native dialog
    const attResp = await startRegistration(options);

    const verification = await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: attResp
    });

    if (verification.verified) {
      // Remember we've registered biometrics for this user
      localStorage.setItem('bio_registered_' + username, '1');
      toast('Biometrics Enabled', 'You can now log in with your fingerprint or face next time.', 'success', 4000);
    }
  } catch (err) {
    // Declined or not supported — fail silently, no error shown
  }
}

// ─── SUCCESS HANDLER ──────────────────────────────────────────────────────────
function handleLoginSuccess(data) {
  localStorage.setItem('auth_token', data.token);
  localStorage.setItem('last_username', data.seller.username);
  localStorage.setItem('role', data.seller.role);
  if (data.business_slug) {
    localStorage.setItem('business_slug', data.business_slug);
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

// ─── DEMO LOGIN ────────────────────────────────────────────────────────────────
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
