// Setup Logic (Magic Link)

const { startRegistration } = SimpleWebAuthnBrowser;
let setupToken = '';

window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  setupToken = urlParams.get('token');

  if (!setupToken) {
    document.getElementById('step-password').innerHTML = `
      <div class="text-center">
        <h2 class="text-red-400 mb-8">Invalid Link</h2>
        <p class="text-dim mb-24">No setup token provided. Please check the link from your admin.</p>
        <a href="/login.html" class="btn btn-outline btn-full">Go to Login</a>
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

      // Save token implicitly logs them in
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('last_username', data.seller.username);
      
      toast('Success', 'Password set successfully', 'success');
      
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
  try {
    // 1. Get options from server
    const options = await apiFetch('/api/auth/webauthn/register-options', {
      method: 'POST'
    });

    // 2. Start browser registration
    let attResp;
    try {
      attResp = await startRegistration(options);
    } catch (err) {
      throw new Error(err.name === 'NotAllowedError' ? 'Registration cancelled' : err.message);
    }

    // 3. Send response to server to verify
    const verification = await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: attResp
    });

    if (verification.verified) {
      toast('Success', 'Biometrics enabled! Redirecting...', 'success');
      setTimeout(finishSetup, 1500);
    }
  } catch (err) {
    toast('Biometric Setup Failed', err.message, 'error');
  }
}

function finishSetup() {
  window.location.replace('/seller.html');
}
