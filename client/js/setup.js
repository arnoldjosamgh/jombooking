// Setup Logic (Magic Link) — Password setup + auto biometric registration

const { startRegistration } = SimpleWebAuthnBrowser;
let setupToken = '';

window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  setupToken = urlParams.get('token');

  if (!setupToken) {
    document.getElementById('step-password').innerHTML = `
      <div class="text-center">
        <h2 style="color:#ef4444" class="mb-8">Invalid Link</h2>
        <p class="text-dim mb-24">No setup token provided. Please check the link from your admin.</p>
        <a href="/login.html" class="btn btn-primary btn-full">Go to Login</a>
      </div>
    `;
    return;
  }

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('setup-btn');
    btn.disabled = true;
    btn.textContent = 'Setting password…';

    const password = document.getElementById('password').value;

    try {
      const data = await apiFetch('/api/auth/setup-password', {
        method: 'POST',
        body: { token: setupToken, password }
      });

      // Store full session
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('last_username', data.seller.username);
      localStorage.setItem('role', data.seller.role);
      if (data.business_slug) {
        localStorage.setItem('business_slug', data.business_slug);
        localStorage.setItem('first_login_' + data.business_slug, '1');
      }

      // Move to biometric step — auto-trigger
      document.getElementById('step-password').style.display = 'none';
      document.getElementById('step-biometrics').style.display = 'block';

      // Auto-trigger biometric setup after a short delay (feels natural)
      setTimeout(() => autoSetupBiometrics(data.seller.username), 800);

    } catch (err) {
      toast('Error', err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Set Password';
    }
  });
});

// ─── AUTO-TRIGGER BIOMETRICS ──────────────────────────────────────────────────
async function autoSetupBiometrics(username) {
  // Show the "setting up" state
  const bioBtn   = document.querySelector('#step-biometrics .btn-primary');
  const statusEl = document.getElementById('bio-status');
  if (bioBtn)   { bioBtn.disabled = true; bioBtn.textContent = 'Waiting for your device…'; }
  if (statusEl) statusEl.textContent = 'Your device will prompt you to scan your face or fingerprint.';

  try {
    if (!window.PublicKeyCredential) throw new Error('not_supported');

    const options = await apiFetch('/api/auth/webauthn/register-options', { method: 'POST' });
    const attResp = await startRegistration(options);

    const verification = await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: attResp
    });

    if (verification.verified) {
      localStorage.setItem('bio_registered_' + username, '1');
      toast('Biometrics Enabled!', 'You can now log in with your face or fingerprint.', 'success');
      setTimeout(finishSetup, 1500);
    } else {
      throw new Error('Verification failed');
    }
  } catch (err) {
    // Device doesn't support it, or user declined — that's fine, proceed to dashboard
    const retryBtn = document.getElementById('bio-retry-btn');
    const spinner  = document.getElementById('bio-spinner');
    if (bioBtn)    { bioBtn.style.display = 'none'; }
    if (retryBtn)  { retryBtn.style.display = 'block'; }
    if (spinner)   { spinner.style.display = 'none'; }
    if (statusEl) {
      if (err.message === 'not_supported') {
        statusEl.textContent = 'Biometrics not supported on this device. You can skip.';
      } else if (err.name === 'NotAllowedError') {
        statusEl.textContent = 'Biometric setup was cancelled. Tap Try Again or Skip.';
      } else {
        statusEl.textContent = 'Could not set up biometrics. Tap Try Again or Skip.';
      }
    }
  }
}

// Called by "Try Again" button or "Skip" button
function setupBiometrics() {
  const username = localStorage.getItem('last_username') || '';
  autoSetupBiometrics(username);
}

function finishSetup() {
  window.location.replace('/seller.html');
}
