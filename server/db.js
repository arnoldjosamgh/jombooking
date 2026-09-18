require('dotenv').config();
const { Pool } = require('pg');

// Main Control Plane Pool (for sellers, businesses, etc.)
const mainPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('aivencloud'))
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

mainPool.on('error', (err) => {
  console.error('[DB Control Plane] Unexpected pool error:', err.message);
});

// Cache for tenant DB connection pools
const tenantPools = new Map();

/**
 * Get or create a PostgreSQL connection pool for a specific tenant DB URL.
 * @param {string} dbUrl 
 * @returns {Pool}
 */
function getTenantDb(dbUrl) {
  if (!dbUrl) throw new Error('Tenant DB URL is required');
  
  if (tenantPools.has(dbUrl)) {
    return tenantPools.get(dbUrl);
  }

  const tenantPool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') || dbUrl.includes('amazonaws.com') || dbUrl.includes('aivencloud')
      ? { rejectUnauthorized: false }
      : false,
    max: 5, // Lower max connections per tenant to avoid exhausting limits
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });

  tenantPool.on('error', (err) => {
    console.error(`[DB Tenant] Unexpected pool error:`, err.message);
  });

  tenantPools.set(dbUrl, tenantPool);
  return tenantPool;
}

// Export the main pool query interface, plus the main pool itself and the tenant getter
module.exports = {
  query: (text, params) => mainPool.query(text, params),
  mainPool,
  getTenantDb
};
