// Login Logic

const { startAuthentication } = SimpleWebAuthnBrowser;

window.addEventListener('DOMContentLoaded', () => {
  const usernameInput = document.getElementById('username');
  
  // Try to load last username
  const lastUser = localStorage.getItem('last_username');
  if (lastUser) {
    usernameInput.value = lastUser;
    checkBiometrics(lastUser);
  }

  usernameInput.addEventListener('blur', (e) => {
    checkBiometrics(e.target.value.trim());
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'Logging in...';

    const username = usernameInput.value.trim();
    const password = document.getElementById('password').value;

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });
      
      handleLoginSuccess(data);
    } catch (err) {
      toast('Login Failed', err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });
});

async function checkBiometrics(username) {
  if (!username) return;
  // Just a quick optimistic check if we have them locally, or show the button and let the server decide.
  // We'll show the button if username is entered. The server will reject if no biometrics.
  document.getElementById('biometric-section').style.display = 'block';
}

async function loginWithBiometrics() {
  const username = document.getElementById('username').value.trim();
  if (!username) {
    toast('Error', 'Please enter your username first', 'error');
    return;
  }

  try {
    // 1. Get options from server
    const options = await apiFetch('/api/auth/webauthn/auth-options', {
      method: 'POST',
      body: { username }
    });

    // 2. Start browser authentication
    let asseResp;
    try {
      asseResp = await startAuthentication(options);
    } catch (err) {
      throw new Error(err.name === 'NotAllowedError' ? 'Authentication cancelled' : err.message);
    }

    // 3. Send response to server to verify
    const verification = await apiFetch('/api/auth/webauthn/auth-verify', {
      method: 'POST',
      body: { username, response: asseResp }
    });

    if (verification.verified) {
      handleLoginSuccess(verification);
    }
  } catch (err) {
    toast('Biometric Login Failed', err.message, 'error');
  }
}

function handleLoginSuccess(data) {
  localStorage.setItem('auth_token', data.token);
  localStorage.setItem('last_username', data.seller.username);
  localStorage.setItem('role', data.seller.role);
  if (data.business_slug) {
    localStorage.setItem('business_slug', data.business_slug);
  }
  
  toast('Success', 'Logged in successfully', 'success');
  
  setTimeout(() => {
    if (data.seller.role === 'tech') {
      window.location.href = '/tech.html';
    } else {
      window.location.href = '/seller.html';
    }
  }, 1000);
}
