/**
 * Jomish — Tech Dashboard Logic
 * Handles company creation, seller onboarding links, and company listing
 */

window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('auth_token');
  if (!token) { window.location.replace('/login.html'); return; }

  // Verify tech role
  try {
    await loadCompanies();
  } catch (err) {
    if (err.message && (err.message.includes('401') || err.message.includes('403'))) {
      localStorage.clear();
      window.location.replace('/login.html');
    }
  }

  // Force uppercase prefix
  const prefixInput = document.getElementById('cc-prefix');
  prefixInput.addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase().replace(/[^A-Z]/g, '');
    this.setSelectionRange(pos, pos);
  });

  document.getElementById('create-company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('cc-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const prefix   = document.getElementById('cc-prefix').value.trim().toUpperCase();
    const number   = document.getElementById('cc-number').value.trim();
    const type     = document.getElementById('cc-type').value;
    const bizName  = document.getElementById('cc-name').value.trim();

    if (prefix.length < 3 || prefix.length > 4) {
      toast('Invalid Prefix', 'Prefix must be 3 or 4 letters (e.g. JOM or JOMI)', 'error');
      btn.disabled = false; btn.textContent = 'Create Company & Generate Links';
      return;
    }

    try {
      const data = await apiFetch('/api/tech/business', {
        method: 'POST',
        body: { prefix, number, type, biz_name: bizName || null }
      });

      toast('Created!', `Company ${data.username} set up successfully`, 'success');

      // ─── Show the generated links ────────────────────────────
      document.getElementById('result-username').textContent = data.username;

      const setupInput = document.getElementById('magic-link-url');
      setupInput.value = data.magicLink;

      // Permanent client link uses the actual slug returned from the API
      const clientSlug = data.business.slug;
      const clientLink = `${window.location.origin}/c/${clientSlug}`;
      document.getElementById('client-link-url').value = clientLink;

      document.getElementById('no-links-msg').style.display = 'none';
      document.getElementById('magic-link-result').style.display = 'block';

      // Reset form
      e.target.reset();
      loadCompanies();
    } catch (err) {
      toast('Error', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Company & Generate Links';
    }
  });
});

async function loadCompanies() {
  const tbody = document.getElementById('companies-list');
  tbody.innerHTML = `<tr><td colspan="5" class="text-center text-dim">Loading…</td></tr>`;
  try {
    const list = await apiFetch('/api/tech/businesses');

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-dim" style="padding:24px">No companies yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(b => `
      <tr>
        <td style="padding:12px 8px;font-weight:600">${b.name}</td>
        <td style="padding:12px 8px">
          <span class="badge ${b.type === 'product' ? 'badge-gold' : 'badge-blue'}">
            ${b.type === 'product' ? 'Product' : 'Service'}
          </span>
        </td>
        <td style="padding:12px 8px;font-family:monospace;letter-spacing:0.05em">${b.owner_username}</td>
        <td style="padding:12px 8px">
          ${b.is_setup
            ? `<span class="badge badge-green">Active</span>`
            : `<span class="badge" style="background:#f1f5f9;color:#64748b">Pending Setup</span>`}
        </td>
        <td style="padding:12px 8px">
          <button class="btn btn-outline" style="padding:6px 12px;font-size:0.78rem"
            onclick="regenerateLinks('${b.slug}','${b.owner_username}')">
            View Links
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    if (err.message && (err.message.includes('401') || err.message.includes('403'))) {
      localStorage.clear(); window.location.replace('/login.html');
    } else {
      toast('Error', 'Could not load companies: ' + err.message, 'error');
    }
  }
}

// Show client link for an existing company
function regenerateLinks(slug, username) {
  const clientLink = `${window.location.origin}/c/${slug}`;
  document.getElementById('result-username').textContent = username;
  document.getElementById('magic-link-url').value = '(Use setup link from original enrollment)';
  document.getElementById('client-link-url').value = clientLink;
  document.getElementById('no-links-msg').style.display = 'none';
  document.getElementById('magic-link-result').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function copyLink(id) {
  const input = document.getElementById(id);
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value)
    .then(() => toast('Copied', 'Link copied to clipboard', 'success'))
    .catch(() => {
      input.select();
      document.execCommand('copy');
      toast('Copied', 'Link copied to clipboard', 'success');
    });
}

function logout() {
  localStorage.clear();
  window.location.replace('/login.html');
}
