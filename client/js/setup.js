// Setup Logic (Magic Link)

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
    btn.textContent = 'Setting password...';

    const password = document.getElementById('password').value;

    try {
      const data = await apiFetch('/api/auth/setup-password', {
        method: 'POST',
        body: { token: setupToken, password }
      });

      // Store full session — same as login
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('last_username', data.seller.username);
      localStorage.setItem('role', data.seller.role);
      if (data.business_slug) {
        localStorage.setItem('business_slug', data.business_slug);
        // Mark as first login so seller.html shows onboarding
        localStorage.setItem('first_login_' + data.business_slug, '1');
      }

      toast('Success', 'Password set! Setting up biometrics...', 'success');

      // Move to Step 2
      document.getElementById('step-password').style.display = 'none';
      document.getElementById('step-biometrics').style.display = 'block';

    } catch (err) {
      toast('Error', err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Set Password';
    }
  });
});

async function setupBiometrics() {
  const btn = document.querySelector('#step-biometrics .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up...'; }

  try {
    // 1. Get options from server (token must be set in localStorage already)
    const options = await apiFetch('/api/auth/webauthn/register-options', {
      method: 'POST'
    });

    // 2. Start browser registration
    let attResp;
    try {
      attResp = await startRegistration(options);
    } catch (err) {
      throw new Error(err.name === 'NotAllowedError' ? 'Registration cancelled or not supported on this device' : err.message);
    }

    // 3. Send response to server to verify
    const verification = await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: attResp
    });

    if (verification.verified) {
      toast('Success', 'Biometrics enabled! Taking you to your dashboard...', 'success');
      setTimeout(finishSetup, 1500);
    }
  } catch (err) {
    toast('Biometric Setup Failed', err.message + ' — You can skip and set up later.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Enable Biometrics'; }
  }
}

function finishSetup() {
  window.location.replace('/seller.html');
}
