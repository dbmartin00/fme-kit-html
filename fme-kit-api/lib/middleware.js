import { verifyToken } from './auth.js';

/**
 * Express middleware to require authentication via JWT token
 * Extracts token from Authorization: Bearer header, verifies it,
 * and attaches user info to req.user
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next function
 */
function requireAuth(req, res, next) {
  // Check if auth is enabled
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  if (!authEnabled) {
    // Auth disabled, skip validation
    return next();
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'NO_TOKEN'
    });
  }

  // Check Bearer format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'Invalid authorization header format. Expected: Bearer <token>',
      code: 'INVALID_AUTH_HEADER'
    });
  }

  const token = parts[1];

  // Verify token
  try {
    const decoded = verifyToken(token);
    req.user = decoded; // Attach user info to request
    next();
  } catch (error) {
    if (error.message === 'TOKEN_EXPIRED') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    } else if (error.message === 'INVALID_TOKEN') {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // Unexpected error
    console.error('Token verification error:', error);
    return res.status(401).json({
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
}

export {
  requireAuth
};
