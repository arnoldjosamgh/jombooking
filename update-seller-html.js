const fs = require('fs');

let html = fs.readFileSync('client/seller.html', 'utf8');

// 1. Add Tabs and Floating Button to seller.html
if (!html.includes('seller-tabs')) {
  html = html.replace('<main class="seller-layout" id="seller-content" style="display:none;"></main>', 
  `
  <div id="seller-tabs" class="seller-tabs" style="display:none; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e2e8f0; gap: 12px; overflow-x: auto;">
  </div>
  <main class="seller-layout" id="seller-content" style="display:none; overflow-y: auto; height: calc(100vh - 120px);"></main>
  
  <button id="fab-pending" onclick="renderPending()" style="display:none; align-items:center; justify-content:center; position:fixed; bottom:24px; right:24px; width:64px; height:64px; border-radius:32px; background:var(--accent-orange); color:#fff; border:none; box-shadow:0 6px 16px rgba(244,168,29,0.4); z-index:9999; cursor:pointer; transition: transform 0.2s;">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
    <span id="fab-badge" style="position:absolute; top:8px; right:8px; background:#ef4444; color:white; border-radius:10px; padding:2px 6px; font-size:0.75rem; font-weight:bold; display:none;">0</span>
  </button>
  
  <template id="tpl-pending">
    <div style="padding:24px; max-width:800px; margin:0 auto;">
      <h3 class="mb-16">Pending Orders & Bookings</h3>
      <div id="pending-list"></div>
    </div>
  </template>
  
  <template id="tpl-history">
    <div style="padding:24px; max-width:800px; margin:0 auto;">
      <h3 class="mb-16">Transaction History</h3>
      <div id="history-list"></div>
    </div>
  </template>
  `);
  fs.writeFileSync('client/seller.html', html);
  console.log('seller.html updated with tabs, templates, and FAB.');
}
