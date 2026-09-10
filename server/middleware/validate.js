/**
 * Jomish Booking System — Input Validation Middleware
 */

function requireFields(...fields) {
  return (req, res, next) => {
    const body = req.body;
    const missing = fields.filter(f => !body[f] && body[f] !== 0);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    next();
  };
}

module.exports = { requireFields };
