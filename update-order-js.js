const fs = require('fs');

let js = fs.readFileSync('client/js/order.js', 'utf8');

const orderSuccessOld = `function showOrderSuccess(orders) {`;
const orderSuccessNew = `function showOrderSuccess(orders) {
  const orderIds = orders.map(o => o.id);
  const checkStatus = setInterval(async () => {
    try {
      const res = await apiFetch(\`/api/orders/list/\${business.id}\`);
      const myOrders = res.filter(o => orderIds.includes(o.id));
      const allCompleted = myOrders.length > 0 && myOrders.every(o => o.status === 'completed');
      if (allCompleted) {
        clearInterval(checkStatus);
        document.getElementById('main-content').innerHTML = \`
          <div class="container-sm" style="padding-top:32px;text-align:center;">
            <div class="success-screen" style="border: 2px solid var(--accent-green);">
              <div class="success-icon" style="background:var(--accent-green);">🎉</div>
              <h2 style="color:var(--accent-green);font-size:2rem;margin-top:16px;">Delivered!</h2>
              <p class="mt-8">Thank you for your order.</p>
              <button class="btn btn-outline mt-20" onclick="window.location.reload()">Place Another Order</button>
            </div>
          </div>
        \`;
      }
    } catch (e) {}
  }, 5000);
`;

if (js.includes(orderSuccessOld) && !js.includes('setInterval(async () => {')) {
  js = js.replace(orderSuccessOld, orderSuccessNew);
  fs.writeFileSync('client/js/order.js', js);
  console.log('order.js updated with delivery polling.');
} else {
  console.log('order.js already updated or could not find target.');
}
