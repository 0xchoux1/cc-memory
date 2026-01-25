/**
 * GitHubSyncAdapter tests
 *
 * These tests use a local git repository to simulate GitHub sync behavior.
 * For actual GitHub integration testing, set environment variables:
 * - GITHUB_TEST_REPO_URL: Git repository URL
 * - GITHUB_TOKEN: Personal access token (for HTTPS auth)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { GitHubSyncAdapter } from '../../src/sync/adapters/GitHubSyncAdapter.js';
import type { ParallelizationExport } from '../../src/memory/types.js';

describe('GitHubSyncAdapter', () => {
  let tempDir: string;
  let bareRepoPath: string;
  let workDir1: string;
  let workDir2: string;

  const createDelta = (id: string = 'test-tachikoma'): ParallelizationExport => ({
    version: '1.0.0',
    format: 'tachikoma-parallelize-delta',
    tachikomaId: id,
    tachikomaName: `Tachikoma ${id}`,
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

  const initBareRepo = (path: string): void => {
    execSync('git init --bare', { cwd: path, stdio: 'ignore' });
    // Create initial commit in a temp working copy
    const initDir = mkdtempSync(join(tmpdir(), 'git-init-'));
    execSync(`git clone "${path}" .`, { cwd: initDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: initDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: initDir, stdio: 'ignore' });
    execSync('touch .gitkeep', { cwd: initDir, stdio: 'ignore' });
    execSync('git add .', { cwd: initDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: initDir, stdio: 'ignore' });
    execSync('git push origin main', { cwd: initDir, stdio: 'ignore' });
    rmSync(initDir, { recursive: true, force: true });
  };

  beforeAll(() => {
    // Check if git is available
    try {
      execSync('git --version', { stdio: 'ignore' });
    } catch {
      throw new Error('Git is required to run GitHubSyncAdapter tests');
    }
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-memory-github-'));
    bareRepoPath = join(tempDir, 'repo.git');
    workDir1 = join(tempDir, 'work1');
    workDir2 = join(tempDir, 'work2');

    // Create a bare repository to simulate remote
    execSync(`mkdir -p "${bareRepoPath}"`, { stdio: 'ignore' });
    initBareRepo(bareRepoPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes by cloning the repository', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test Author',
      authorEmail: 'test@example.com',
    });

    await adapter.initialize();

    expect(existsSync(workDir1)).toBe(true);
    expect(existsSync(join(workDir1, '.git'))).toBe(true);
    expect(existsSync(join(workDir1, 'deltas'))).toBe(true);

    await adapter.close();
  });

  it('pushes delta to repository', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter.initialize();
    adapter.setTachikomaId('tachikoma-1');

    const delta = createDelta('tachikoma-1');
    const result = await adapter.push(delta);

    expect(result.success).toBe(true);

    // Check file was created
    const tachikomaDir = join(workDir1, 'deltas', 'tachikoma-1');
    expect(existsSync(tachikomaDir)).toBe(true);

    const files = readdirSync(tachikomaDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d+\.json$/);

    await adapter.close();
  });

  it('pulls deltas from repository', async () => {
    // First adapter pushes
    const adapter1 = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter1.initialize();
    adapter1.setTachikomaId('tachikoma-1');

    const delta = createDelta('tachikoma-1');
    await adapter1.push(delta);
    await adapter1.close();

    // Second adapter pulls
    const adapter2 = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir2,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter2.initialize();
    adapter2.setTachikomaId('tachikoma-2');

    const pulled = await adapter2.pull();

    expect(pulled.length).toBe(1);
    expect(pulled[0].tachikomaId).toBe('tachikoma-1');
    expect(pulled[0].delta.working[0].key).toBe('test-key');

    await adapter2.close();
  });

  it('skips own deltas when pulling', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter.initialize();
    adapter.setTachikomaId('self-tachikoma');

    // Push own delta
    const ownDelta = createDelta('self-tachikoma');
    await adapter.push(ownDelta);

    // Pull should skip own delta
    const pulled = await adapter.pull();
    expect(pulled.length).toBe(0);

    await adapter.close();
  });

  it('marks pulled deltas as imported', async () => {
    // Push from adapter1
    const adapter1 = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      autoPush: true,
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter1.initialize();
    adapter1.setTachikomaId('tachikoma-1');
    await adapter1.push(createDelta('tachikoma-1'));
    await adapter1.close();

    // Pull from adapter2
    const adapter2 = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir2,
      branch: 'main',
      autoPush: false, // Don't auto-push to avoid conflicts
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter2.initialize();
    adapter2.setTachikomaId('tachikoma-2');

    const pulled = await adapter2.pull();
    expect(pulled.length).toBe(1);

    // Second pull should return nothing (already imported)
    const pulled2 = await adapter2.pull();
    expect(pulled2.length).toBe(0);

    await adapter2.close();
  });

  it('handles multiple tachikoma directories', async () => {
    const adapter1 = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter1.initialize();

    // Push from multiple tachikomas
    for (const id of ['alpha', 'beta', 'gamma']) {
      adapter1.setTachikomaId(id);
      const delta = createDelta(id);
      delta.exportedAt = Date.now() + Math.random() * 1000;
      await adapter1.push(delta);
    }

    await adapter1.close();

    // Pull from another instance
    const adapter2 = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir2,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter2.initialize();
    adapter2.setTachikomaId('delta');

    const pulled = await adapter2.pull();
    expect(pulled.length).toBe(3);

    const ids = pulled.map(d => d.tachikomaId).sort();
    expect(ids).toEqual(['alpha', 'beta', 'gamma']);

    await adapter2.close();
  });

  it('returns correct status', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    // Before init
    const statusBefore = await adapter.getStatus();
    expect(statusBefore.connected).toBe(false);

    await adapter.initialize();
    adapter.setTachikomaId('status-test');

    // After init, no pending
    const statusAfter = await adapter.getStatus();
    expect(statusAfter.connected).toBe(true);
    expect(statusAfter.pendingChanges).toBe(0);

    await adapter.close();
  });

  it('provides git status information', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter.initialize();

    const gitStatus = await adapter.getGitStatus();
    expect(gitStatus.current).toBe('main');
    expect(gitStatus.ahead).toBe(0);
    expect(gitStatus.behind).toBe(0);

    await adapter.close();
  });

  it('uses custom deltas directory', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      deltasDir: 'custom-deltas',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter.initialize();
    adapter.setTachikomaId('custom');

    await adapter.push(createDelta('custom'));

    expect(existsSync(join(workDir1, 'custom-deltas'))).toBe(true);
    expect(existsSync(join(workDir1, 'custom-deltas', 'custom'))).toBe(true);

    await adapter.close();
  });

  it('sanitizes tachikoma IDs for directory names', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      branch: 'main',
      authorName: 'Test',
      authorEmail: 'test@test.com',
    });

    await adapter.initialize();

    const delta = createDelta('../evil/../path');
    await adapter.push(delta);

    // Should sanitize to safe directory name
    const deltasDir = join(workDir1, 'deltas');
    const dirs = readdirSync(deltasDir);
    expect(dirs).toContain('.._evil_.._path');
    expect(dirs).not.toContain('../evil/../path');

    await adapter.close();
  });

  it('handles network errors gracefully', async () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: 'invalid://not-a-real-url',
      localPath: workDir1,
      branch: 'main',
    });

    await expect(adapter.initialize()).rejects.toThrow();
  });

  it('uses default name and branch', () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
    });

    expect(adapter.name).toBe('github');
    expect(adapter.type).toBe('file');
  });

  it('allows custom name', () => {
    const adapter = new GitHubSyncAdapter({
      repoUrl: bareRepoPath,
      localPath: workDir1,
      name: 'my-github-sync',
    });

    expect(adapter.name).toBe('my-github-sync');
  });
});
