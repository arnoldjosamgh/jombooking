/**
 * Jomish — Sales Retention Scheduler
 * Runs daily at midnight:
 *  - Day 88: Sends push notification warning about upcoming purge
 *  - Day 90: Purges orders older than 90 days
 */
const cron = require('node-cron');
const db   = require('./db');
const { sendPushToSeller } = require('./routes/push');

function startRetentionScheduler() {
  // Run once per day at 01:00 server time
  cron.schedule('0 1 * * *', async () => {
    console.log('[Retention] Running daily data-retention job...');
    try {
      // Warn sellers 2 days in advance (records that will be 90 days old in 2 days)
      const warnRes = await db.query(
        `SELECT DISTINCT business_id
         FROM orders
         WHERE created_at < NOW() - INTERVAL '88 days'
           AND created_at >= NOW() - INTERVAL '89 days'`
      );

      for (const row of warnRes.rows) {
        try {
          await sendPushToSeller(row.business_id, {
            type: 'retention-warning',
            title: 'Upcoming Sales History Purge',
            body: 'Your sales records older than 90 days will be automatically deleted in 2 days. Download your history now to keep a copy.',
          });
        } catch (e) {
          console.error('[Retention] Push warn failed for biz', row.business_id, e.message);
        }
      }

      // Purge orders older than 90 days
      const purge = await db.query(
        `DELETE FROM orders WHERE created_at < NOW() - INTERVAL '90 days' RETURNING id`
      );
      if (purge.rows.length > 0) {
        console.log(`[Retention] Purged ${purge.rows.length} order(s) older than 90 days.`);
      }
    } catch (err) {
      console.error('[Retention] Job failed:', err.message);
    }
  });

  console.log('[Retention] Scheduler started (runs daily at 01:00).');
}

module.exports = { startRetentionScheduler };
