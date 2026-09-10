// Tech Dashboard Logic

window.addEventListener('DOMContentLoaded', async () => {
  // Verify token is present
  if (!localStorage.getItem('auth_token')) {
    window.location.replace('/login.html');
    return;
  }

  loadCompanies();

  document.getElementById('create-company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('cc-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const prefix = document.getElementById('cc-prefix').value.trim();
    const number = document.getElementById('cc-number').value.trim();
    const type = document.getElementById('cc-type').value;

    try {
      const data = await apiFetch('/api/tech/business', {
        method: 'POST',
        body: { prefix, number, type }
      });

      toast('Success', `Company ${data.username} created`, 'success');
      
      // Show magic link
      document.getElementById('magic-link-result').style.display = 'block';
      document.getElementById('magic-link-url').value = data.magicLink;

      // Reset form
      document.getElementById('cc-prefix').value = '';
      document.getElementById('cc-number').value = '';

      loadCompanies(); // Refresh list
    } catch (err) {
      toast('Error', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Company & Generate Link';
    }
  });
});

async function loadCompanies() {
  try {
    const list = await apiFetch('/api/tech/businesses');
    const tbody = document.getElementById('companies-list');
    
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="padding: 12px 8px; text-align: center; color: var(--text-500);">No companies found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(b => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 12px 8px; font-weight: 600;">${b.name}</td>
        <td style="padding: 12px 8px;"><span class="badge ${b.type === 'product' ? 'badge-gold' : 'badge-blue'}">${b.type}</span></td>
        <td style="padding: 12px 8px; font-family: monospace;">${b.owner_username}</td>
        <td style="padding: 12px 8px;">
          ${b.is_setup 
            ? `<span class="text-green-400">✓ Setup Complete</span>` 
            : `<span class="text-dim">Pending Setup</span>`}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('403')) {
      logout();
    } else {
      toast('Error loading companies', err.message, 'error');
    }
  }
}

function copyMagicLink() {
  const input = document.getElementById('magic-link-url');
  input.select();
  document.execCommand('copy');
  toast('Copied', 'Magic link copied to clipboard', 'info');
}

function logout() {
  localStorage.removeItem('auth_token');
  window.location.replace('/login.html');
}
