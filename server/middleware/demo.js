/**
 * Demo Mode Middleware
 * If a user has is_demo: true in their JWT, all state-changing requests
 * are intercepted and return a simulated success WITHOUT touching the database.
 */
function demoGuard(req, res, next) {
  if (req.user && req.user.is_demo) {
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      // Return a fake success response
      return res.json({
        _demo: true,
        message: '✅ Action simulated in Demo Mode — no data was changed.',
        ok: true,
        success: true,
        id: 9999,
        status: 'completed'
      });
    }
  }
  next();
}

module.exports = { demoGuard };
