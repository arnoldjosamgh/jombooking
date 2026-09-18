/**
 * Jomish — Products & Orders Routes
 * Includes POS multi-item checkout, barcode lookup, and seller product management
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireFields } = require('../middleware/validate');
const { authenticate } = require('./auth');
const { sendPushToSeller, sendPushToClient } = require('./push');

// ─── GET /api/orders/list/:business_id ────────────────────────────────────────
// MUST be defined before /:business_slug wildcard to avoid being shadowed
// Accepts business_id (numeric) OR business slug
router.get('/list/:business_id', async (req, res) => {
  try {
    const { status } = req.query;
    const bizParam = req.params.business_id;
    // Determine if it's a slug or numeric id
    const isNumeric = /^\d+$/.test(bizParam);
    const bizFilter = isNumeric
      ? 'o.business_id = $1'
      : 'o.business_id = (SELECT id FROM businesses WHERE slug = $1 LIMIT 1)';

    let query = `
      SELECT o.id, o.order_group_id, o.quantity, o.status, o.created_at, o.updated_at, o.total_price, o.notes, o.seller_id,
             o.receipt_number,
             p.title AS product_title, p.price,
             c.id AS client_id, c.name AS client_name, c.location AS client_location,
             s.username AS seller_username,
             biz.name AS business_name, biz.location AS business_location,
             biz.phone_number AS business_phone, biz.logo_url AS business_logo
      FROM orders o
      JOIN products p ON o.product_id = p.id
      JOIN clients c ON o.client_id = c.id
      JOIN businesses biz ON o.business_id = biz.id
      LEFT JOIN sellers s ON o.seller_id = s.id
      WHERE ${bizFilter}
    `;
    const params = [bizParam];
    if (status) { query += ` AND o.status = $2`; params.push(status); }
    query += ' ORDER BY COALESCE(o.updated_at, o.created_at) DESC LIMIT 100';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[orders] GET /list/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/products/:business_slug ─────────────────────────────────────────
router.get('/:business_slug', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.title, p.description, p.price, p.image_url, p.stock_quantity, p.barcode
       FROM products p
       JOIN businesses b ON p.business_id = b.id
       WHERE b.slug = $1 AND (p.is_deleted = false OR p.is_deleted IS NULL)
       ORDER BY p.title`,
      [req.params.business_slug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[products] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/products/barcode/:code ──────────────────────────────────────────
router.get('/barcode/:code', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.title, p.price, p.stock_quantity, p.image_url, p.barcode
       FROM products p WHERE p.barcode = $1 LIMIT 1`,
      [req.params.code]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found for this barcode' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/products/manage ─────────────────────────────────────────────────
// Seller adds a new product to their business
router.post('/manage', authenticate, requireFields('business_id', 'title', 'price'), async (req, res) => {
  try {
    const { business_id, title, description, price, barcode, stock_quantity, image_url } = req.body;
    const result = await db.query(
      `INSERT INTO products (business_id, title, description, price, barcode, stock_quantity, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [business_id, title, description || '', parseFloat(price), barcode || null, parseInt(stock_quantity || 0), image_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[products] POST /manage error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/products/manage/:id/stock ──────────────────────────────────────
router.patch('/manage/:id/stock', authenticate, async (req, res) => {
  try {
    const { stock_quantity } = req.body;
    const result = await db.query(
      `UPDATE products SET stock_quantity = $1 WHERE id = $2 RETURNING *`,
      [parseInt(stock_quantity), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DELETE /api/products/manage/:id ───────────────────────────────────────────
// Soft-delete: product hidden from POS but orders referencing it remain intact
router.delete('/manage/:id', authenticate, async (req, res) => {
  try {
    await db.query('UPDATE products SET is_deleted = true WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[products] DELETE /manage/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Single item order (client-facing)
router.post('/', requireFields('business_id', 'client_id', 'product_id', 'quantity'), async (req, res) => {
  const client = await db.connect();
  try {
    const { business_id, client_id, product_id, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    await client.query('BEGIN');

    const stockResult = await client.query(
      `UPDATE products SET stock_quantity = stock_quantity - $1
       WHERE id = $2 AND stock_quantity >= $1
       RETURNING id, stock_quantity`,
      [qty, product_id]
    );

    if (stockResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Out of stock or insufficient quantity' });
    }

    const orderResult = await client.query(
      `INSERT INTO orders (business_id, client_id, product_id, quantity, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [business_id, client_id, product_id, qty]
    );

    // Auto-generate receipt number
    await client.query(
      `UPDATE orders SET receipt_number = 'ORD-' || LPAD(id::text, 5, '0') WHERE id = $1`,
      [orderResult.rows[0].id]
    );

    await client.query('COMMIT');

    const bizRes = await db.query('SELECT owner_id, pusher_channel FROM businesses WHERE id = $1', [business_id]);
    if (bizRes.rows.length > 0) {
      const biz = bizRes.rows[0];

      // Real-time push to TV display and seller dashboard
      const io = req.app.get('io');
      if (io) {
        const channel = biz.pusher_channel || `biz-${business_id}`;
        io.to(`seller-${channel}`).emit('order:waiting', {
          orderId: orderResult.rows[0].id,
          clientName: '',
          timestamp: new Date().toISOString(),
        });
      }

      sendPushToSeller(biz.owner_id, {
        title: 'New Order Request',
        body: 'You received a new product order.',
        url: '/seller'
      });
    }

    const fullOrder = await db.query(
      `SELECT o.id, o.quantity, o.status, o.created_at,
              p.title AS product_title, p.price,
              c.name AS client_name, c.location AS client_location
       FROM orders o
       JOIN products p ON o.product_id = p.id
       JOIN clients c ON o.client_id = c.id
       WHERE o.id = $1`,
      [orderResult.rows[0].id]
    );

    res.status(201).json(fullOrder.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders] POST / error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── POST /api/orders/bulk ────────────────────────────────────────────────────
// Multi-item order (client-facing)
router.post('/bulk', requireFields('business_id', 'client_id', 'items'), async (req, res) => {
  const client = await db.connect();
  try {
    const { business_id, client_id, items, table_number } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items in order' });

    await client.query('BEGIN');
    const orderGroupId = require('crypto').randomUUID();
    const createdOrders = [];

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const stockResult = await client.query(
        `UPDATE products SET stock_quantity = stock_quantity - $1
         WHERE id = $2 AND stock_quantity >= $1
         RETURNING id, stock_quantity, price`,
        [qty, item.product_id]
      );

      if (stockResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Out of stock for product #${item.product_id}` });
      }
      
      const itemPrice = parseFloat(stockResult.rows[0].price);
      const balanceRemaining = qty * itemPrice;
      const paymentMethod = table_number ? 'momo' : 'cash';

      const orderResult = await client.query(
        `INSERT INTO orders (business_id, client_id, product_id, quantity, status, order_group_id, table_number, payment_method, payment_status, balance_remaining)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, 'pending', $8) RETURNING *`,
        [business_id, client_id, item.product_id, qty, orderGroupId, table_number || null, paymentMethod, balanceRemaining]
      );
      
      const orderId = orderResult.rows[0].id;
      await client.query(
        `UPDATE orders SET receipt_number = 'ORD-' || LPAD($1::text, 5, '0') WHERE id = $1`,
        [orderId]
      );

      const fullOrder = await client.query(
        `SELECT o.id, o.quantity, o.status, o.created_at, o.order_group_id, o.table_number, o.payment_method, o.payment_status, o.amount_paid, o.balance_remaining,
                p.title AS product_title, p.price,
                c.name AS client_name, c.location AS client_location
         FROM orders o
         JOIN products p ON o.product_id = p.id
         JOIN clients c ON o.client_id = c.id
         WHERE o.id = $1`,
        [orderId]
      );
      createdOrders.push(fullOrder.rows[0]);
    }

    await client.query('COMMIT');

    const bizRes = await db.query('SELECT owner_id, pusher_channel FROM businesses WHERE id = $1', [business_id]);
    if (bizRes.rows.length > 0) {
      const biz = bizRes.rows[0];
      
      const io = req.app.get('io');
      if (io) {
        const channel = biz.pusher_channel || `biz-${business_id}`;
        // Build a summary string: "Fries x2, Club Soda x1"
        const summary = createdOrders.map(o => `${o.product_title} ×${o.quantity}`).join(', ');
        io.to(`seller-${channel}`).emit('order:waiting', {
          orderId: createdOrders[0].id,
          orderGroupId: createdOrders[0].order_group_id,
          clientName: createdOrders[0].client_name,
          productTitle: createdOrders.length === 1 ? createdOrders[0].product_title : `${createdOrders.length} items`,
          quantity: createdOrders.length === 1 ? createdOrders[0].quantity : null,
          summary,
          tableNumber: createdOrders[0].table_number,
          timestamp: new Date().toISOString()
        });
      }

      sendPushToSeller(biz.owner_id, {
        title: 'New Order Request',
        body: `You received a new order with ${items.length} item(s).`,
        url: '/seller'
      });
    }
    
    res.status(201).json(createdOrders);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders] POST /bulk error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── POST /api/orders/pos-checkout ────────────────────────────────────────────
// POS: multi-item checkout from seller dashboard. Items = [{product_id, qty}]
router.post('/pos-checkout', authenticate, async (req, res) => {
  const client = await db.connect();
  try {
    const { business_id, items, customer_name, notes } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items in order' });

    await client.query('BEGIN');

    // Create a walk-in client record
    const clientRes = await client.query(
      `INSERT INTO clients (name, location) VALUES ($1, 'Walk-in') RETURNING id`,
      [customer_name || 'Walk-in Customer']
    );
    const clientId = clientRes.rows[0].id;

    let total = 0;
    const createdOrders = [];

    const orderGroupId = require('crypto').randomUUID();

    for (const item of items) {
      const qty = parseInt(item.qty);
      // Decrement stock atomically
      const stock = await client.query(
        `UPDATE products SET stock_quantity = stock_quantity - $1
         WHERE id = $2 AND stock_quantity >= $1
         RETURNING id, title, price`,
        [qty, item.product_id]
      );
      if (stock.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Insufficient stock for product #${item.product_id}` });
      }
      const price = parseFloat(stock.rows[0].price);
      total += price * qty;

      const order = await client.query(
        `INSERT INTO orders (business_id, client_id, product_id, quantity, status, total_price, notes, seller_id, order_group_id)
         VALUES ($1, $2, $3, $4, 'ready', $5, $6, $7, $8) RETURNING id`,
        [business_id, clientId, item.product_id, qty, price * qty, notes || null, req.user.id, orderGroupId]
      );
      createdOrders.push({ id: order.rows[0].id, product: stock.rows[0].title, qty, price });
    }

    // Assign receipt numbers to POS orders
    for (const ord of createdOrders) {
      await client.query(
        `UPDATE orders SET receipt_number = 'ORD-' || LPAD($1::text, 5, '0') WHERE id = $1`,
        [ord.id]
      );
    }

    await client.query('COMMIT');

    // Emit socket event to update TV
    const io = req.app.get('io');
    if (io) {
      const bizRes = await db.query('SELECT pusher_channel FROM businesses WHERE id = $1', [business_id]);
      if (bizRes.rows.length > 0) {
        const channel = bizRes.rows[0].pusher_channel || `biz-${business_id}`;
        // We can just emit once to trigger a reload on the TV
        if (createdOrders.length > 0) {
          io.to(`seller-${channel}`).emit('order:status', { orderId: createdOrders[0].id, status: 'ready' });
        }
      }
    }

    res.status(201).json({ success: true, total, items: createdOrders, client_id: clientId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pos-checkout] error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// (GET /api/orders/list/:business_id is now defined at the top of this file, before the wildcard route)

// ─── PATCH /api/orders/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'ready', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    const result = await db.query(
      `UPDATE orders SET status = $1, seller_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, status, client_id, business_id, receipt_number, quantity`,
      [status, req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    
    const order = result.rows[0];
    
    // Auto-send receipt in messages if ready or completed
    if ((status === 'ready' || status === 'completed') && order.client_id) {
      try {
        const prodRes = await db.query(
          `SELECT p.title, p.price, b.slug, b.logo_url FROM products p JOIN orders o ON o.product_id = p.id JOIN businesses b ON o.business_id = b.id WHERE o.id = $1`,
          [order.id]
        );
        if (prodRes.rows.length > 0) {
          const p = prodRes.rows[0];
          const total = (parseFloat(p.price) * order.quantity).toFixed(2);
          const receiptContent = `[RECEIPT] Order ${order.receipt_number || '#' + order.id}\n${p.title} x${order.quantity}\nTotal: $${total}`;
          await db.query(
            `INSERT INTO messages (business_id, client_id, sender, content) VALUES ($1, $2, 'seller', $3)`,
            [order.business_id, order.client_id, receiptContent]
          );

          if (status === 'ready') {
            sendPushToClient(order.client_id, {
              type: 'order-ready',
              title: 'Order Ready — Collect Now',
              body: `Your order for ${p.title} is ready. Click to view/download receipt.`,
              url: `/c/${p.slug}?action=download-receipt`,
              icon: p.logo_url
            });
          } else if (status === 'completed') {
            sendPushToClient(order.client_id, {
              type: 'download-receipt',
              title: 'Receipt Ready — Download Now',
              body: `Your receipt for ${p.title} is ready. Tap to download.`,
              url: `/c/${p.slug}?action=download-receipt&order_id=${order.id}`,
              icon: p.logo_url
            });
            
            // Insert Thank You message and emit to chat
            const msgResult = await db.query(
              `INSERT INTO messages (business_id, client_id, sender, content) VALUES ($1, $2, 'seller', $3) RETURNING *`,
              [order.business_id, order.client_id, 'Thank you for your payment! Enjoy your order.']
            );
            
            // Emit socket event to client room for instant download and chat
            const io2 = req.app.get('io');
            if (io2) {
              const room = `chat-${order.business_id}-${order.client_id}`;
              io2.to(room).emit('chat:message', msgResult.rows[0]);
              io2.to(room).emit('order:completed', { orderId: order.id, bizSlug: p.slug });
            }
          }
        }
      } catch (err) {
        console.error('[orders] Failed to send receipt message or push:', err.message);
      }
    }

    const io = req.app.get('io');
    if (io) {
      const bizRes = await db.query('SELECT pusher_channel FROM businesses WHERE id = $1', [order.business_id]);
      if (bizRes.rows.length > 0) {
        const channel = bizRes.rows[0].pusher_channel || `biz-${order.business_id}`;
        io.to(`seller-${channel}`).emit('order:status', { orderId: order.id, status });
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[orders] PATCH /status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
// ─── PATCH /api/orders/group/:orderGroupId/status ────────────────────────────
router.patch('/group/:orderGroupId/status', authenticate, async (req, res) => {
  const client = await db.connect();
  try {
    const { status } = req.body;
    const { orderGroupId } = req.params;
    if (!['pending', 'ready', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    
    await client.query('BEGIN');
    const groupRes = await client.query('SELECT * FROM orders WHERE order_group_id = $1', [orderGroupId]);
    if (groupRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order group not found' });
    }
    
    await client.query('UPDATE orders SET status = $1, seller_id = $2, updated_at = CURRENT_TIMESTAMP WHERE order_group_id = $3', [status, req.user.id, orderGroupId]);
    
    const firstOrder = groupRes.rows[0];
    
    if ((status === 'ready' || status === 'completed') && firstOrder.client_id) {
       const prodRes = await client.query(
         `SELECT p.title, p.price, o.quantity, b.slug, b.logo_url 
          FROM products p JOIN orders o ON o.product_id = p.id JOIN businesses b ON o.business_id = b.id 
          WHERE o.order_group_id = $1`, [orderGroupId]
       );
       const items = prodRes.rows;
       if (items.length > 0) {
         const slug = items[0].slug;
         const logo = items[0].logo_url;
         const total = items.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
         const totalBalance = groupRes.rows.reduce((sum, item) => sum + parseFloat(item.balance_remaining || 0), 0);
         const itemsText = items.map(i => `${i.title} x${i.quantity}`).join(', ');
         const receiptContent = `[RECEIPT] Order #${firstOrder.receipt_number || firstOrder.id}\nItems: ${itemsText}\nTotal: $${total.toFixed(2)}`;
         
         await client.query(`INSERT INTO messages (business_id, client_id, sender, content) VALUES ($1, $2, 'seller', $3)`, [firstOrder.business_id, firstOrder.client_id, receiptContent]);
         
         const io2 = req.app.get('io');
         if (status === 'ready') {
           sendPushToClient(firstOrder.client_id, {
             type: 'order-ready', title: 'Order Ready', body: `Your order is ready. Balance: $${totalBalance.toFixed(2)}. Tap to pay.`, url: `/c/${slug}`, icon: logo
           });
           if (io2) io2.to(`chat-${firstOrder.business_id}-${firstOrder.client_id}`).emit('order:ready', {
             orderGroupId,
             balanceRemaining: totalBalance,
             totalAmount: total,
             paymentMethod: firstOrder.payment_method
           });
         } else if (status === 'completed') {
           sendPushToClient(firstOrder.client_id, {
             type: 'download-receipt', title: 'Receipt Ready', body: `Your receipt is ready. Tap to download.`, url: `/c/${slug}?action=download-receipt&order_id=${orderGroupId}`, icon: logo
           });
           
           const msgResult = await client.query(
             `INSERT INTO messages (business_id, client_id, sender, content) VALUES ($1, $2, 'seller', $3) RETURNING *`,
             [firstOrder.business_id, firstOrder.client_id, 'Thank you for your payment! Enjoy your order.']
           );
           
           if (io2) {
             const room = `chat-${firstOrder.business_id}-${firstOrder.client_id}`;
             io2.to(room).emit('chat:message', msgResult.rows[0]);
             io2.to(room).emit('order:completed', { orderGroupId, bizSlug: slug });
           }
         }
       }
    }
    
    await client.query('COMMIT');
    
    const io = req.app.get('io');
    if (io) {
      const bizRes = await client.query('SELECT pusher_channel FROM businesses WHERE id = $1', [firstOrder.business_id]);
      if (bizRes.rows.length > 0) {
        const channel = bizRes.rows[0].pusher_channel || `biz-${firstOrder.business_id}`;
        io.to(`seller-${channel}`).emit('order:status', { orderId: orderGroupId, status });
      }
    }
    res.json({ success: true, orderGroupId, status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders] PATCH group status error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/orders/group/:orderGroupId/payment ────────────────────────────
router.patch('/group/:orderGroupId/payment', authenticate, async (req, res) => {
  const client = await db.connect();
  try {
    const { action, amountPaid } = req.body;
    const { orderGroupId } = req.params;
    
    await client.query('BEGIN');
    
    // Get all orders in group
    const groupRes = await client.query('SELECT * FROM orders WHERE order_group_id = $1', [orderGroupId]);
    if (groupRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order group not found' });
    }
    
    const firstOrder = groupRes.rows[0];
    const totalBalance = groupRes.rows.reduce((sum, order) => sum + parseFloat(order.balance_remaining), 0);
    const totalAmountPaid = groupRes.rows.reduce((sum, order) => sum + parseFloat(order.amount_paid), 0);
    
    let newStatus = firstOrder.status;
    let newPaymentStatus = firstOrder.payment_status;
    let newAmountPaid = totalAmountPaid;
    let newBalanceRemaining = totalBalance;

    if (action === 'RECEIVED') {
      newStatus = 'completed';
      newPaymentStatus = 'completed';
      newAmountPaid = totalAmountPaid + totalBalance;
      newBalanceRemaining = 0;
    } else if (action === 'NOT_EXACT_AMOUNT') {
      const received = parseFloat(amountPaid) || 0;
      newAmountPaid += received;
      newBalanceRemaining = Math.max(0, totalBalance - received);
      newPaymentStatus = newBalanceRemaining <= 0 ? 'completed' : 'partial';
      if (newBalanceRemaining <= 0) newStatus = 'completed';
    } else if (action === 'NOT_YET') {
      newPaymentStatus = 'pending';
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Since it's a group, we can just distribute the payment to the first order to make it simple,
    // or set all to the new status and put the balance on the first one. 
    // To keep it simple, we update all items to the same status, but we'll set amount/balance correctly.
    
    // For simplicity, we just divide or assign to the first. Let's just update the first one with the balance 
    // and others to 0 balance, OR just set everything proportionally. Let's do it evenly for simplicity or just assign to order[0]
    for (let i = 0; i < groupRes.rows.length; i++) {
      const order = groupRes.rows[i];
      let bal = 0;
      let amt = 0;
      if (i === 0) {
        bal = newBalanceRemaining;
        amt = newAmountPaid;
      }
      await client.query(
        `UPDATE orders SET status = $1, payment_status = $2, amount_paid = $3, balance_remaining = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
        [newStatus, newPaymentStatus, amt, bal, order.id]
      );
    }
    
    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io && firstOrder.client_id) {
      const room = `chat-${firstOrder.business_id}-${firstOrder.client_id}`;
      // Find business slug for links/events if needed
      const bizRes = await client.query('SELECT slug FROM businesses WHERE id = $1', [firstOrder.business_id]);
      const slug = bizRes.rows[0]?.slug;

      if (newStatus === 'completed') {
        const msgResult = await client.query(
          `INSERT INTO messages (business_id, client_id, sender, content) VALUES ($1, $2, 'seller', $3) RETURNING *`,
          [firstOrder.business_id, firstOrder.client_id, 'Thank you for your payment! Enjoy your order.']
        );
        io.to(room).emit('chat:message', msgResult.rows[0]);
        io.to(room).emit('order:completed', { orderGroupId, bizSlug: slug });
      } else {
        // Send a partial payment message
        if (action === 'NOT_EXACT_AMOUNT') {
           const msgResult = await client.query(
             `INSERT INTO messages (business_id, client_id, sender, content) VALUES ($1, $2, 'seller', $3) RETURNING *`,
             [firstOrder.business_id, firstOrder.client_id, `Partial payment received. Paid so far: ${newAmountPaid}. Pending balance: ${newBalanceRemaining}.`]
           );
           io.to(room).emit('chat:message', msgResult.rows[0]);
        }

        io.to(room).emit('order:payment_update', {
          orderGroupId,
          paymentStatus: newPaymentStatus,
          amountPaid: newAmountPaid,
          balanceRemaining: newBalanceRemaining
        });
      }
    }
    
    // notify seller dashboard
    if (io) {
      const bizRes = await client.query('SELECT pusher_channel FROM businesses WHERE id = $1', [firstOrder.business_id]);
      if (bizRes.rows.length > 0) {
        const channel = bizRes.rows[0].pusher_channel || `biz-${firstOrder.business_id}`;
        io.to(`seller-${channel}`).emit('order:status', { orderGroupId, status: newStatus, paymentStatus: newPaymentStatus });
      }
    }

    res.json({ success: true, paymentStatus: newPaymentStatus, balanceRemaining: newBalanceRemaining });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders] PATCH /group/payment error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
