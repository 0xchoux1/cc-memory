/**
 * Print sha256 hash for an API key.
 */

import { createHash } from 'crypto';

const rawKey = process.argv[2];

if (!rawKey) {
  console.error('Usage: node scripts/hash-api-key.js <api-key>');
  process.exit(1);
}

const hash = createHash('sha256').update(rawKey).digest('hex');
console.log(`sha256:${hash}`);
