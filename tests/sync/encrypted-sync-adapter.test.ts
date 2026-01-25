/**
 * EncryptedSyncAdapter tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSyncAdapter } from '../../src/sync/adapters/FileSyncAdapter.js';
import { EncryptedSyncAdapter } from '../../src/sync/adapters/EncryptedSyncAdapter.js';
import {
  encrypt,
  decrypt,
  isEncryptedPayload,
  EncryptionError,
} from '../../src/sync/encryption/index.js';
import type { ParallelizationExport } from '../../src/memory/types.js';

describe('Encryption Utilities', () => {
  const testPassphrase = 'test-passphrase-123!';

  it('encrypts and decrypts data correctly', () => {
    const plaintext = 'Hello, World!';
    const encrypted = encrypt(plaintext, testPassphrase);
    const decrypted = decrypt(encrypted, testPassphrase);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts JSON data correctly', () => {
    const data = {
      name: 'test',
      value: 123,
      nested: { foo: 'bar' },
    };
    const plaintext = JSON.stringify(data);
    const encrypted = encrypt(plaintext, testPassphrase);
    const decrypted = decrypt(encrypted, testPassphrase);

    expect(JSON.parse(decrypted)).toEqual(data);
  });

  it('produces different ciphertext for same plaintext', () => {
    const plaintext = 'Same data';
    const encrypted1 = encrypt(plaintext, testPassphrase);
    const encrypted2 = encrypt(plaintext, testPassphrase);

    // Salt and IV should be different
    expect(encrypted1.salt).not.toBe(encrypted2.salt);
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);

    // But both should decrypt to the same value
    expect(decrypt(encrypted1, testPassphrase)).toBe(plaintext);
    expect(decrypt(encrypted2, testPassphrase)).toBe(plaintext);
  });

  it('fails to decrypt with wrong passphrase', () => {
    const plaintext = 'Secret data';
    const encrypted = encrypt(plaintext, testPassphrase);

    expect(() => decrypt(encrypted, 'wrong-passphrase')).toThrow(EncryptionError);
  });

  it('fails to decrypt corrupted data', () => {
    const plaintext = 'Secret data';
    const encrypted = encrypt(plaintext, testPassphrase);

    // Corrupt the ciphertext
    const corrupted = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'xxxx',
    };

    expect(() => decrypt(corrupted, testPassphrase)).toThrow(EncryptionError);
  });

  it('validates encrypted payload structure', () => {
    const encrypted = encrypt('test', testPassphrase);

    expect(isEncryptedPayload(encrypted)).toBe(true);
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload({})).toBe(false);
    expect(isEncryptedPayload({ version: 1 })).toBe(false);
  });

  it('includes proper metadata in encrypted payload', () => {
    const encrypted = encrypt('test', testPassphrase);

    expect(encrypted.version).toBe(1);
    expect(encrypted.algorithm).toBe('aes-256-gcm');
    expect(encrypted.kdf).toBe('pbkdf2-sha512');
    expect(encrypted.kdfIterations).toBe(100000);
    expect(typeof encrypted.salt).toBe('string');
    expect(typeof encrypted.iv).toBe('string');
    expect(typeof encrypted.authTag).toBe('string');
    expect(typeof encrypted.ciphertext).toBe('string');
  });

  it('uses custom KDF iterations', () => {
    const iterations = 10000;
    const encrypted = encrypt('test', testPassphrase, iterations);

    expect(encrypted.kdfIterations).toBe(iterations);

    // Should still decrypt correctly
    const decrypted = decrypt(encrypted, testPassphrase);
    expect(decrypted).toBe('test');
  });
});

describe('EncryptedSyncAdapter', () => {
  let tempDir: string;
  const testPassphrase = 'test-sync-passphrase-456!';

  const createDelta = (id: string = 'test-tachikoma'): ParallelizationExport => ({
    version: '1.0.0',
    format: 'tachikoma-parallelize-delta',
    tachikomaId: id,
    tachikomaName: 'Test Tachikoma',
    exportedAt: Date.now(),
    syncVector: { [id]: 1 },
    delta: {
      working: [
        {
          id: 'w1',
          type: 'context',
          key: 'test-key',
          value: 'test-value',
          metadata: {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiresAt: Date.now() + 3600000,
            sessionId: 'session-1',
            priority: 'medium',
          },
          tags: ['test'],
        },
      ],
      episodic: [],
      semantic: { entities: [], relations: [] },
    },
    deleted: {
      working: [],
      episodic: [],
      semantic: { entities: [], relations: [] },
    },
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-memory-encrypted-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('encrypts data when pushing', async () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {
      passphrase: testPassphrase,
    });

    await encryptedAdapter.initialize();

    const delta = createDelta();
    const result = await encryptedAdapter.push(delta);

    expect(result.success).toBe(true);

    // Check that the file contains encrypted data
    const files = readdirSync(tempDir).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(1);

    const content = JSON.parse(readFileSync(join(tempDir, files[0]), 'utf-8'));

    // Should have the encrypted structure
    expect(content.delta.working.length).toBe(1);
    expect(content.delta.working[0].key).toBe('__encrypted_payload__');
    expect(content.delta.working[0].value.encrypted).toBe(true);
    expect(isEncryptedPayload(content.delta.working[0].value.payload)).toBe(true);

    await encryptedAdapter.close();
  });

  it('decrypts data when pulling', async () => {
    // Push with one adapter
    const pusherFileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    pusherFileAdapter.setTachikomaId('pusher');
    const pusherEncrypted = new EncryptedSyncAdapter(pusherFileAdapter, {
      passphrase: testPassphrase,
    });

    await pusherEncrypted.initialize();

    const originalDelta = createDelta('pusher');
    await pusherEncrypted.push(originalDelta);
    await pusherEncrypted.close();

    // Pull with another adapter
    const pullerFileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    pullerFileAdapter.setTachikomaId('puller');
    const pullerEncrypted = new EncryptedSyncAdapter(pullerFileAdapter, {
      passphrase: testPassphrase,
    });

    await pullerEncrypted.initialize();

    const pulled = await pullerEncrypted.pull();

    expect(pulled.length).toBe(1);
    expect(pulled[0].tachikomaId).toBe('pusher');
    expect(pulled[0].delta.working.length).toBe(1);
    expect(pulled[0].delta.working[0].key).toBe('test-key');
    expect(pulled[0].delta.working[0].value).toBe('test-value');

    await pullerEncrypted.close();
  });

  it('fails to decrypt with wrong passphrase', async () => {
    // Push with correct passphrase
    const pusherFileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    pusherFileAdapter.setTachikomaId('pusher');
    const pusherEncrypted = new EncryptedSyncAdapter(pusherFileAdapter, {
      passphrase: testPassphrase,
    });

    await pusherEncrypted.initialize();
    await pusherEncrypted.push(createDelta('pusher'));
    await pusherEncrypted.close();

    // Try to pull with wrong passphrase
    const pullerFileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    pullerFileAdapter.setTachikomaId('puller');
    const pullerEncrypted = new EncryptedSyncAdapter(pullerFileAdapter, {
      passphrase: 'wrong-passphrase',
    });

    await pullerEncrypted.initialize();

    // Should return empty array (decryption failures are logged, not thrown)
    const pulled = await pullerEncrypted.pull();
    expect(pulled.length).toBe(0);

    await pullerEncrypted.close();
  });

  it('preserves adapter type and name', async () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir, name: 'my-file' });
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {
      passphrase: testPassphrase,
    });

    expect(encryptedAdapter.type).toBe('file');
    expect(encryptedAdapter.name).toBe('my-file-encrypted');
  });

  it('allows custom name suffix', async () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir, name: 'base' });
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {
      passphrase: testPassphrase,
      nameSuffix: '-secure',
    });

    expect(encryptedAdapter.name).toBe('base-secure');
  });

  it('throws when no passphrase is configured', async () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {});

    await expect(encryptedAdapter.initialize()).rejects.toThrow(EncryptionError);
  });

  it('reads passphrase from environment variable', async () => {
    const envVar = 'TEST_CC_MEMORY_KEY';
    const envPassphrase = 'env-passphrase-789!';

    process.env[envVar] = envPassphrase;

    try {
      const fileAdapter = new FileSyncAdapter({ syncDir: tempDir });
      fileAdapter.setTachikomaId('pusher');
      const pusherEncrypted = new EncryptedSyncAdapter(fileAdapter, {
        passphraseEnvVar: envVar,
      });

      await pusherEncrypted.initialize();
      await pusherEncrypted.push(createDelta('pusher'));
      await pusherEncrypted.close();

      // Pull with same env var
      const pullerFileAdapter = new FileSyncAdapter({ syncDir: tempDir });
      pullerFileAdapter.setTachikomaId('puller');
      const pullerEncrypted = new EncryptedSyncAdapter(pullerFileAdapter, {
        passphraseEnvVar: envVar,
      });

      await pullerEncrypted.initialize();
      const pulled = await pullerEncrypted.pull();
      expect(pulled.length).toBe(1);

      await pullerEncrypted.close();
    } finally {
      delete process.env[envVar];
    }
  });

  it('handles multiple push/pull cycles', async () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    fileAdapter.setTachikomaId('multi-tachikoma');
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {
      passphrase: testPassphrase,
    });

    await encryptedAdapter.initialize();

    // Push multiple deltas
    for (let i = 0; i < 3; i++) {
      const delta = createDelta(`tachikoma-${i}`);
      delta.exportedAt = Date.now() + i;
      await encryptedAdapter.push(delta);
    }

    await encryptedAdapter.close();

    // Pull all deltas with a different adapter
    const pullerAdapter = new FileSyncAdapter({ syncDir: tempDir });
    pullerAdapter.setTachikomaId('puller');
    const pullerEncrypted = new EncryptedSyncAdapter(pullerAdapter, {
      passphrase: testPassphrase,
    });

    await pullerEncrypted.initialize();
    const pulled = await pullerEncrypted.pull();

    expect(pulled.length).toBe(3);

    await pullerEncrypted.close();
  });

  it('exposes inner adapter', () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {
      passphrase: testPassphrase,
    });

    expect(encryptedAdapter.getInnerAdapter()).toBe(fileAdapter);
  });

  it('uses custom KDF iterations', async () => {
    const fileAdapter = new FileSyncAdapter({ syncDir: tempDir });
    fileAdapter.setTachikomaId('pusher');
    const encryptedAdapter = new EncryptedSyncAdapter(fileAdapter, {
      passphrase: testPassphrase,
      kdfIterations: 10000, // Faster for testing
    });

    await encryptedAdapter.initialize();
    await encryptedAdapter.push(createDelta('pusher'));
    await encryptedAdapter.close();

    // Check the stored data uses custom iterations
    const files = readdirSync(tempDir).filter(f => f.endsWith('.json'));
    const content = JSON.parse(readFileSync(join(tempDir, files[0]), 'utf-8'));
    expect(content.delta.working[0].value.payload.kdfIterations).toBe(10000);
  });
});
