/**
 * Full order lifecycle test - creates then completes an order
 */
require('dotenv').config();
const https = require('https');

const HOST = 'jomishmgt.onrender.com';

// Get a real seller token by logging in
function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: HOST,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        console.log(`${method} ${path} → ${res.statusCode}: ${raw.substring(0, 300)}`);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  // Step 1: Login
  console.log('\n=== Step 1: Login ===');
  const loginRes = await apiCall('POST', '/api/auth/login', {
    username: process.env.SELLER_USERNAME || 'demo_owner',
    password: process.env.SELLER_PASSWORD || 'Jomish9!!'
  });
  const token = loginRes.body.token;
  if (!token) { console.error('Login failed!'); return; }
  console.log('Token obtained ✅');

  // Step 2: Get a product to order
  console.log('\n=== Step 2: Get products ===');
  const prodsRes = await apiCall('GET', '/api/products?slug=jomish-cafe', null, token);
  const products = prodsRes.body;
  if (!products || !products.length) { console.error('No products found!'); return; }
  const product = products[0];
  console.log('Using product:', product.id, product.title);

  // Step 3: Create a client
  console.log('\n=== Step 3: Create client ===');
  const clientRes = await apiCall('POST', '/api/clients', {
    name: 'Test Client Debug',
    location: 'Table 1',
    businessId: 1
  });
  const client = clientRes.body;
  console.log('Client:', client.id, client.name);

  // Step 4: Place an order
  console.log('\n=== Step 4: Place order ===');
  const orderRes = await apiCall('POST', '/api/orders', {
    businessId: 1,
    businessSlug: 'jomish-cafe',
    client_id: client.id,
    items: [{ product_id: product.id, quantity: 1 }],
    payment_method: 'cash'
  });
  console.log('Order placed:', JSON.stringify(orderRes.body).substring(0, 200));

  if (orderRes.body.error) {
    console.error('Order failed:', orderRes.body.error);
    return;
  }

  // Step 5: Complete the order
  const orderId = orderRes.body.order_group_id || orderRes.body.orders?.[0]?.id || orderRes.body.id;
  console.log('\n=== Step 5: Complete order (group_id:', orderRes.body.order_group_id, ') ===');
  
  if (orderRes.body.order_group_id) {
    await apiCall('PATCH', `/api/orders/group/${orderRes.body.order_group_id}/status`, { status: 'completed' }, token);
  } else if (orderRes.body.id) {
    await apiCall('PATCH', `/api/orders/${orderRes.body.id}/status`, { status: 'completed' }, token);
  }
}

run().catch(console.error);
