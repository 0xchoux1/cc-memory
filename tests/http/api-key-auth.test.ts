/**
 * API key auth tests
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Request, Response, NextFunction } from 'express';
import { createApiKeyAuth, hashApiKey, loadApiKeysFromFile } from '../../src/server/http/auth/apiKey.js';

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
  res: Response
) {
  const next = vi.fn();
  middleware(req, res, next);
  return { next };
}

describe('API key auth', () => {
  it('accepts hashed keys from file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-memory-auth-'));
    const filePath = join(dir, 'keys.json');
    const rawKey = 'test-api-key';
    const hashed = `sha256:${hashApiKey(rawKey)}`;

    writeFileSync(filePath, JSON.stringify({
      [hashed]: { clientId: 'client-1', scopes: ['memory:read'] },
    }), 'utf-8');

    const config = loadApiKeysFromFile(filePath);
    const middleware = createApiKeyAuth(config);

    const req = {
      headers: { authorization: `Bearer ${rawKey}` },
    } as unknown as Request;
    const res = createRes();

    const { next } = runMiddleware(middleware, req, res);
    expect(next).toHaveBeenCalledOnce();

    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts plaintext keys from file by hashing on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-memory-auth-'));
    const filePath = join(dir, 'keys.json');
    const rawKey = 'plain-key';

    writeFileSync(filePath, JSON.stringify({
      [rawKey]: { clientId: 'client-2', scopes: ['memory:read'] },
    }), 'utf-8');

    const config = loadApiKeysFromFile(filePath);
    const middleware = createApiKeyAuth(config);

    const req = {
      headers: { authorization: `Bearer ${rawKey}` },
    } as unknown as Request;
    const res = createRes();

    const { next } = runMiddleware(middleware, req, res);
    expect(next).toHaveBeenCalledOnce();

    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects invalid keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-memory-auth-'));
    const filePath = join(dir, 'keys.json');

    writeFileSync(filePath, JSON.stringify({
      [hashApiKey('valid')]: { clientId: 'client-3', scopes: ['memory:read'] },
    }), 'utf-8');

    const config = loadApiKeysFromFile(filePath);
    const middleware = createApiKeyAuth(config);

    const req = {
      headers: { authorization: 'Bearer invalid' },
    } as unknown as Request;
    const res = createRes();

    runMiddleware(middleware, req, res);
    expect(res.status).toHaveBeenCalledWith(401);

    rmSync(dir, { recursive: true, force: true });
  });
});
