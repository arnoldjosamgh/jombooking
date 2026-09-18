const db = require('../db');

/**
 * Middleware to resolve the tenant DB from the business slug/ID
 * and attach its connection pool to req.tenantDb
 */
async function attachTenantDb(req, res, next) {
  try {
    // Determine the business identifier from params, query, or body
    const slug = req.params.slug || req.query.slug || req.body.businessSlug;
    const businessId = req.params.businessId || req.query.businessId || req.body.businessId;

    let bizRes;
    if (slug) {
      bizRes = await db.query('SELECT tenant_db_url FROM businesses WHERE slug = $1 LIMIT 1', [slug]);
    } else if (businessId) {
      bizRes = await db.query('SELECT tenant_db_url FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
    } else if (req.user && req.user.role !== 'tech') {
      // Fallback: If seller is logged in, find their business
      bizRes = await db.query('SELECT tenant_db_url FROM businesses WHERE owner_id = $1 LIMIT 1', [req.user.id]);
    }

    if (!bizRes || bizRes.rows.length === 0) {
      // If we cannot determine a specific tenant, default to the main DB
      // This happens for global/tech operations
      req.tenantDb = db;
      return next();
    }

    const tenantUrl = bizRes.rows[0].tenant_db_url;
    if (!tenantUrl) {
      // If the business doesn't have a specific tenant DB URL, fallback to main DB
      req.tenantDb = db;
    } else {
      // Get the cached connection pool for this tenant
      req.tenantDb = db.getTenantDb(tenantUrl);
    }

    next();
  } catch (err) {
    console.error('[Tenant Middleware] Error attaching DB:', err.message);
    res.status(500).json({ error: 'Database connection failed' });
  }
}

module.exports = { attachTenantDb };
