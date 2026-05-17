import crypto from 'node:crypto';

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomPassword(bytes = 18) {
  // URL-safe, no padding, easy to paste
  return crypto.randomBytes(bytes).toString('base64url');
}
