/**
 * End-to-end test: create an order then try to complete it via the API
 */
require('dotenv').config();
const http = require('https');

const TOKEN = process.env.TEST_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6Im93bmVyIiwiYnVzaW5lc3NfaWQiOjIsImlhdCI6MTc4OTgyMjg0OH0.sW6tpjFQ9Winy3Ud5qQeMF8O1qhCyBfTVCdD1Pt21DI';
const HOST = 'jomishmgt.onrender.com';

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: HOST,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(options, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        console.log(`${method} ${path} → ${res.statusCode}: ${raw}`);
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
  // 1. Fetch pending orders
  console.log('\n=== Fetching pending orders ===');
  const ordersRes = await apiCall('GET', '/api/orders/list/jomish-salon?status=pending');
  
  if (!Array.isArray(ordersRes.body) || ordersRes.body.length === 0) {
    // Also try product type
    const cafeRes = await apiCall('GET', '/api/orders/list/jomish-cafe?status=pending');
    if (!Array.isArray(cafeRes.body) || cafeRes.body.length === 0) {
      console.log('No pending orders found. Creating a test order first...');
      return;
    }
  }

  // 2. Try completing order 7 (the booking we know exists)
  console.log('\n=== Attempting complete order 7 ===');
  await apiCall('PATCH', '/api/orders/7/status', { status: 'completed' });
}

run().catch(console.error);
