import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const AUTH_USERS = process.env.AUTH_USERS || '';

/**
 * Parse users from AUTH_USERS environment variable
 * Format: username1:hash1|username2:hash2
 * @returns {Map<string, string>} Map of username to bcrypt hash
 */
function parseUsers() {
  const users = new Map();

  if (!AUTH_USERS) {
    return users;
  }

  const userPairs = AUTH_USERS.split('|');
  for (const pair of userPairs) {
    const [username, hash] = pair.split(':');
    if (username && hash) {
      users.set(username.trim(), hash.trim());
    }
  }

  return users;
}

/**
 * Validate username and password against stored credentials
 * @param {string} username - Username to validate
 * @param {string} password - Plain text password to check
 * @returns {Promise<boolean>} True if credentials are valid
 */
async function validateCredentials(username, password) {
  if (!username || !password) {
    return false;
  }

  const users = parseUsers();
  const storedHash = users.get(username);

  if (!storedHash) {
    return false;
  }

  try {
    return await bcrypt.compare(password, storedHash);
  } catch (error) {
    console.error('Error validating credentials:', error);
    return false;
  }
}

/**
 * Generate JWT token for authenticated user
 * @param {string} username - Username to include in token
 * @returns {string} JWT token
 */
function generateToken(username) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable not set');
  }

  return jwt.sign(
    { username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify JWT token and return decoded payload
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded token payload with username
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable not set');
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('TOKEN_EXPIRED');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('INVALID_TOKEN');
    }
    throw error;
  }
}

/**
 * Validate authentication is properly configured
 * @throws {Error} If AUTH_ENABLED=true but required env vars are missing
 */
function validateAuthConfig() {
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  if (!authEnabled) {
    return;
  }

  if (!JWT_SECRET) {
    throw new Error('AUTH_ENABLED=true but JWT_SECRET environment variable not set');
  }

  if (!AUTH_USERS) {
    throw new Error('AUTH_ENABLED=true but AUTH_USERS environment variable not set');
  }

  const users = parseUsers();
  if (users.size === 0) {
    throw new Error('AUTH_ENABLED=true but no valid users found in AUTH_USERS');
  }

  console.log(`Authentication enabled with ${users.size} user(s)`);
}

export {
  validateCredentials,
  generateToken,
  verifyToken,
  validateAuthConfig
};
