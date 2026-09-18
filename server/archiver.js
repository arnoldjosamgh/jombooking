/**
 * Jomish — Data Archiver
 * Runs on the 1st of every month (via node-cron).
 * For every business that has a tenant_db_url set:
 *   1. Exports orders older than 3 months to a JSON file in /archives/<slug>/
 *   2. Deletes those records from the tenant DB to free up space
 * Archives are downloadable via GET /api/archives/:slug/:filename (seller-authenticated).
 */
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const cron = require('node-cron');
const db   = require('./db');

const ARCHIVES_DIR = path.join(__dirname, '..', 'archives');

// Ensure top-level archives directory exists
if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR, { recursive: true });

/**
 * Archive old orders for a single tenant.
 * @param {{ slug: string, tenant_db_url: string }} biz
 */
async function archiveTenant(biz) {
  const tenantDb = db.getTenantDb(biz.tenant_db_url);

  // 1. Fetch orders older than 3 months
  const result = await tenantDb.query(
    `SELECT o.*, p.title AS product_title
     FROM orders o
     LEFT JOIN products p ON o.product_id = p.id
     WHERE o.created_at < NOW() - INTERVAL '3 months'
     ORDER BY o.created_at ASC`
  );

  if (result.rows.length === 0) {
    console.log(`[Archiver] No old data for ${biz.slug}`);
    return { slug: biz.slug, archived: 0 };
  }

  // 2. Write to archive file
  const bizDir = path.join(ARCHIVES_DIR, biz.slug);
  if (!fs.existsSync(bizDir)) fs.mkdirSync(bizDir, { recursive: true });

  const now = new Date();
  const label = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const filename = `orders_${label}.json`;
  const filePath = path.join(bizDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(result.rows, null, 2), 'utf8');
  console.log(`[Archiver] Saved ${result.rows.length} orders for ${biz.slug} → ${filename}`);

  // 3. Delete archived orders from tenant DB
  await tenantDb.query(
    `DELETE FROM orders WHERE created_at < NOW() - INTERVAL '3 months'`
  );
  console.log(`[Archiver] Cleared old orders for ${biz.slug}`);

  return { slug: biz.slug, archived: result.rows.length, filename };
}

/**
 * Run the archiver for all tenants.
 */
async function runArchiver() {
  console.log('[Archiver] Starting...');
  const bizList = await db.query(
    `SELECT slug, tenant_db_url FROM businesses WHERE tenant_db_url IS NOT NULL`
  );

  if (bizList.rows.length === 0) {
    console.log('[Archiver] No tenants with dedicated databases found.');
    return;
  }

  const results = [];
  for (const biz of bizList.rows) {
    try {
      const r = await archiveTenant(biz);
      results.push(r);
    } catch (err) {
      console.error(`[Archiver] Error archiving ${biz.slug}:`, err.message);
      results.push({ slug: biz.slug, error: err.message });
    }
  }

  console.log('[Archiver] Done.', results);
  return results;
}

// ─── Schedule: 1st of every month at 02:00 AM ────────────────────────────────
cron.schedule('0 2 1 * *', () => {
  runArchiver().catch(console.error);
});

console.log('[Archiver] Scheduled for 1st of every month at 02:00 AM');

module.exports = { runArchiver, ARCHIVES_DIR };
