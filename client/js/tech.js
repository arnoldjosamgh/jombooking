/**
 * Jomish — Tech Dashboard Logic
 * Multi-seller creation, pause/unpause, delete with confirmation
 */

let pendingDeleteId = null;

window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('auth_token');
  if (!token) { window.location.replace('/login.html'); return; }

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
    const originalHTML = btn.innerHTML;

    // Get selected type
    const typeRadio = document.querySelector('input[name="cc-type"]:checked');
    if (!typeRadio) {
      toast('Select Type', 'Please select a business type (Product, Service, or Both)', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite">
        <path d="M21 12a9 9 0 11-6.22-8.56"/>
      </svg>
      Creating…`;

    const prefix   = document.getElementById('cc-prefix').value.trim().toUpperCase();
    const count    = parseInt(document.getElementById('cc-count').value) || 1;
    const type     = typeRadio.value;
    const bizName  = document.getElementById('cc-name').value.trim();

    if (prefix.length < 3 || prefix.length > 4) {
      toast('Invalid Prefix', 'Prefix must be 3 or 4 letters', 'error');
      btn.disabled = false; btn.innerHTML = originalHTML;
      return;
    }

    try {
      const data = await apiFetch('/api/tech/business', {
        method: 'POST',
        body: { prefix, count, type, biz_name: bizName || null }
      });

      // Show result
      const typeLabel = type === 'both' ? 'Product + Service' : (type === 'product' ? 'Product (POS)' : 'Service (Calendar)');
      document.getElementById('result-username').textContent = data.companyName;
      document.getElementById('result-subtext').textContent =
        `${data.sellers.length} account${data.sellers.length > 1 ? 's' : ''} created — Type: ${typeLabel}`;

      const list = document.getElementById('seller-result-list');
      list.innerHTML = data.sellers.map((s, i) => `
        <div class="seller-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="s-username">${s.username}</div>
            <span style="color:#94a3b8;font-size:0.75rem">Seller ${i + 1}</span>
          </div>
          <div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;margin-bottom:8px">Setup link — send to account holder</div>
          <div class="s-link-row">
            <input type="text" value="${s.magicLink}" readonly id="link-${i}">
            <button class="copy-btn" onclick="copyText('link-${i}')">Copy</button>
          </div>
        </div>
      `).join('');

      document.getElementById('no-links-msg').style.display = 'none';
      document.getElementById('magic-link-result').style.display = 'block';

      toast('Created!', `${data.sellers.length} seller account(s) created for ${data.companyName}`, 'success');
      e.target.reset();
      loadCompanies();
    } catch (err) {
      toast('Error', err.message || 'Failed to create company', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  });
});

// ─── Load Companies Table ───────────────────────────────────────────────────
async function loadCompanies() {
  const tbody = document.getElementById('companies-list');
  tbody.innerHTML = `<tr><td colspan="5" class="text-center text-dim" style="padding:24px">Loading…</td></tr>`;
  try {
    const list = await apiFetch('/api/tech/businesses');

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-dim" style="padding:32px">No companies yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(b => {
      const typeBadge = b.type === 'product'
        ? `<span class="type-badge type-product">Product</span>`
        : b.type === 'service'
        ? `<span class="type-badge type-service">Service</span>`
        : `<span class="type-badge type-both">Both</span>`;

      const statusBadge = b.status === 'paused'
        ? `<span class="status-badge paused">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="#854d0e"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            Paused
           </span>`
        : `<span class="status-badge active">
            <svg width="8" height="8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#16a34a"/></svg>
            Active
           </span>`;

      const sellers = (b.sellers || []).map(s =>
        `<span class="${s.is_setup ? '' : 'setup-pending'}">${s.username}${s.is_setup ? '' : '*'}</span>`
      ).join('');

      const pauseLabel = b.status === 'paused' ? 'Unpause' : 'Pause';

      return `
        <tr>
          <td style="font-weight:600">${b.name}</td>
          <td>${typeBadge}</td>
          <td>
            <div class="sellers-list">${sellers}</div>
            <div style="color:#94a3b8;font-size:0.7rem;margin-top:3px">* = setup pending</div>
          </td>
          <td>${statusBadge}</td>
          <td>
            <div class="action-btns">
              <button class="btn-sm btn-links" onclick="viewSetupLinks(${b.id})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                Links
              </button>
              <button class="btn-sm btn-pause" onclick="togglePause(${b.id}, '${b.status}')">
                ${b.status === 'paused'
                  ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Unpause`
                  : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`}
              </button>
              <button class="btn-sm btn-delete" onclick="deleteCompany(${b.id}, '${b.name.replace(/'/g,"\\'")}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (err.message && (err.message.includes('401') || err.message.includes('403'))) {
      localStorage.clear(); window.location.replace('/login.html');
    } else {
      toast('Error', 'Could not load companies: ' + err.message, 'error');
    }
  }
}

// ─── Toggle Pause ───────────────────────────────────────────────────────────
async function togglePause(id, currentStatus) {
  try {
    const data = await apiFetch(`/api/tech/business/${id}/toggle-pause`, { method: 'PUT' });
    const newStatus = data.status;
    toast(newStatus === 'paused' ? 'Paused' : 'Activated',
      `Business is now ${newStatus}`, newStatus === 'paused' ? 'error' : 'success');
    loadCompanies();
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

// ─── Delete Company ─────────────────────────────────────────────────────────
function deleteCompany(id, name) {
  pendingDeleteId = id;
  document.getElementById('delete-modal-msg').textContent =
    `This will permanently remove "${name}", all its seller accounts, products, services, orders, and bookings. This cannot be undone.`;
  document.getElementById('delete-modal').classList.add('show');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('delete-modal').classList.remove('show');
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('delete-confirm-btn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await apiFetch(`/api/tech/business/${pendingDeleteId}`, { method: 'DELETE' });
    toast('Deleted', 'Company removed successfully', 'success');
    closeDeleteModal();
    loadCompanies();
  } catch (err) {
    toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Delete';
  }
}

// ─── View setup links for existing company ─────────────────────────────────
async function viewSetupLinks(bizId) {
  try {
    const list = await apiFetch('/api/tech/businesses');
    const biz = list.find(b => b.id === bizId);
    if (!biz) return;

    document.getElementById('result-username').textContent = biz.name;
    document.getElementById('result-subtext').textContent = `Showing setup links for all ${biz.sellers.length} seller(s)`;

    const origin = window.location.origin;
    const sellerList = document.getElementById('seller-result-list');
    sellerList.innerHTML = (biz.sellers || []).map((s, i) => {
      const linkValue = s.setup_token
        ? `${origin}/setup.html?token=${s.setup_token}`
        : '(Password already set — share the login page)';
      return `
        <div class="seller-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="s-username">${s.username}</div>
            <span style="color:${s.is_setup ? '#10b981' : '#94a3b8'};font-size:0.75rem">${s.is_setup ? '✓ Active' : 'Pending Setup'}</span>
          </div>
          <div class="s-link-row" style="margin-top:8px">
            <input type="text" value="${linkValue}" readonly id="elink-${i}">
            ${s.setup_token ? `<button class="copy-btn" onclick="copyText('elink-${i}')">Copy</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('no-links-msg').style.display = 'none';
    document.getElementById('magic-link-result').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast('Error', err.message, 'error');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function copyText(id) {
  const el = document.getElementById(id);
  if (!el || !el.value) return;
  navigator.clipboard.writeText(el.value)
    .then(() => toast('Copied', 'Link copied!', 'success'))
    .catch(() => { el.select(); document.execCommand('copy'); toast('Copied', 'Link copied!', 'success'); });
}

function logout() {
  localStorage.clear();
  window.location.replace('/login.html');
}
