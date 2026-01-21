/**
 * FileSyncAdapter tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSyncAdapter } from '../../src/sync/adapters/FileSyncAdapter.js';
import type { ParallelizationExport } from '../../src/memory/types.js';

describe('FileSyncAdapter', () => {
  it('sanitizes tachikomaId in filenames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-memory-sync-'));
    const adapter = new FileSyncAdapter({ syncDir: dir, name: 'test' });
    await adapter.initialize();

    const delta: ParallelizationExport = {
      version: '1.0.0',
      format: 'tachikoma-parallelize-delta',
      tachikomaId: '../evil/..',
      exportedAt: 123,
      syncVector: {},
      delta: {
        working: [],
        episodic: [],
        semantic: { entities: [], relations: [] },
      },
      deleted: {
        working: [],
        episodic: [],
        semantic: { entities: [], relations: [] },
      },
    };

    await adapter.push(delta);

    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe('.._evil_.._123.json');

    rmSync(dir, { recursive: true, force: true });
  });
});
