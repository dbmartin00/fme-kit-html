#!/usr/bin/env node

/**
 * CLI tool to generate bcrypt password hashes
 * Usage: node scripts/hash-password.js <password>
 * Output: bcrypt hash suitable for AUTH_USERS environment variable
 */

import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

async function hashPassword(password) {
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    return hash;
  } catch (error) {
    console.error('Error hashing password:', error);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/hash-password.js <password>');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/hash-password.js mypassword123');
    console.log('');
    console.log('Output format for AUTH_USERS:');
    console.log('  username:$2b$10$hash');
    console.log('');
    console.log('Multiple users separated by pipe:');
    console.log('  admin:$2b$10$hash1|user2:$2b$10$hash2');
    process.exit(0);
  }

  const password = args[0];

  if (!password) {
    console.error('Error: Password cannot be empty');
    process.exit(1);
  }

  console.log('Hashing password...');
  const hash = await hashPassword(password);

  console.log('');
  console.log('Bcrypt hash:');
  console.log(hash);
  console.log('');
  console.log('Add to .env file as:');
  console.log(`AUTH_USERS=username:${hash}`);
  console.log('');
  console.log('For multiple users:');
  console.log(`AUTH_USERS=admin:${hash}|user2:$2b$10$anotherhash`);
}

main();
