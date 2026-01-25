/**
 * GitHubSyncAdapter - Git-based sync adapter for cc-memory
 * Syncs memories via a Git repository (GitHub, GitLab, etc.)
 *
 * @example
 * ```typescript
 * const github = new GitHubSyncAdapter({
 *   repoUrl: 'git@github.com:user/cc-memory-sync.git',
 *   localPath: '~/.cc-memory/github-sync',
 *   branch: 'main',
 * });
 * ```
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { simpleGit, SimpleGit } from 'simple-git';
import type { ParallelizationExport, TachikomaId } from '../../memory/types.js';
import type {
  SyncAdapter,
  SyncAdapterType,
  SyncResult,
  SyncStatus,
} from '../types.js';

/**
 * Configuration for GitHubSyncAdapter
 */
export interface GitHubSyncAdapterConfig {
  /** Git repository URL (SSH or HTTPS) */
  repoUrl: string;

  /** Local path for the cloned repository */
  localPath: string;

  /** Branch to use (default: 'main') */
  branch?: string;

  /** Subdirectory within the repo for deltas (default: 'deltas') */
  deltasDir?: string;

  /** Author name for commits */
  authorName?: string;

  /** Author email for commits */
  authorEmail?: string;

  /** Human-readable name for this adapter */
  name?: string;

  /** Auto-pull before push (default: true) */
  autoPull?: boolean;

  /** Auto-push after commit (default: true) */
  autoPush?: boolean;
}

/**
 * GitHubSyncAdapter - Syncs memories via a Git repository
 */
export class GitHubSyncAdapter implements SyncAdapter {
  readonly type: SyncAdapterType = 'file'; // Treated as file-based sync
  readonly name: string;

  private readonly config: Required<Omit<GitHubSyncAdapterConfig, 'repoUrl' | 'authorName' | 'authorEmail'>> & {
    repoUrl: string;
    authorName?: string;
    authorEmail?: string;
  };
  private git: SimpleGit | null = null;
  private currentTachikomaId?: TachikomaId;
  private lastSyncAt?: number;
  private initialized = false;

  constructor(config: GitHubSyncAdapterConfig) {
    this.config = {
      repoUrl: config.repoUrl,
      localPath: this.expandPath(config.localPath),
      branch: config.branch || 'main',
      deltasDir: config.deltasDir || 'deltas',
      name: config.name || 'github',
      autoPull: config.autoPull ?? true,
      autoPush: config.autoPush ?? true,
      authorName: config.authorName,
      authorEmail: config.authorEmail,
    };
    this.name = this.config.name;
  }

  /**
   * Set the current Tachikoma ID to filter out self-exports
   */
  setTachikomaId(id: TachikomaId): void {
    this.currentTachikomaId = id;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const localPath = this.config.localPath;

    // Ensure parent directory exists
    const parentDir = dirname(localPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Clone or open existing repo
    if (!existsSync(localPath)) {
      // Clone the repository
      await this.cloneRepo();
    } else if (!existsSync(join(localPath, '.git'))) {
      throw new Error(`Path exists but is not a git repository: ${localPath}`);
    }

    // Initialize simple-git
    const git = simpleGit(localPath);
    this.git = git;

    // Configure author if provided
    if (this.config.authorName) {
      await git.addConfig('user.name', this.config.authorName, false, 'local');
    }
    if (this.config.authorEmail) {
      await git.addConfig('user.email', this.config.authorEmail, false, 'local');
    }

    // Ensure we're on the right branch
    await this.ensureBranch();

    // Ensure deltas directory exists
    const deltasPath = this.getDeltasPath();
    if (!existsSync(deltasPath)) {
      mkdirSync(deltasPath, { recursive: true });
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    this.git = null;
    this.initialized = false;
  }

  async push(delta: ParallelizationExport): Promise<SyncResult> {
    if (!this.git) {
      return {
        success: false,
        syncedItems: 0,
        conflicts: [],
        error: 'Adapter not initialized',
      };
    }

    try {
      // Pull latest changes first
      if (this.config.autoPull) {
        await this.pullChanges();
      }

      // Create the delta file
      const safeId = this.sanitizeFilenamePart(delta.tachikomaId);
      if (!safeId) {
        throw new Error('Invalid Tachikoma ID for filename');
      }

      // Organize by Tachikoma ID
      const tachikomaDir = join(this.getDeltasPath(), safeId);
      if (!existsSync(tachikomaDir)) {
        mkdirSync(tachikomaDir, { recursive: true });
      }

      const filename = `${delta.exportedAt}.json`;
      const filepath = join(tachikomaDir, filename);
      const relativePath = join(this.config.deltasDir, safeId, filename);

      writeFileSync(filepath, JSON.stringify(delta, null, 2), 'utf-8');

      // Stage, commit, and push
      await this.git.add(relativePath);

      const statusResult = await this.git.status();
      if (statusResult.staged.length > 0) {
        const commitMessage = `sync: ${delta.tachikomaName || delta.tachikomaId} @ ${new Date(delta.exportedAt).toISOString()}`;
        await this.git.commit(commitMessage);

        if (this.config.autoPush) {
          await this.git.push('origin', this.config.branch);
        }
      }

      const syncedItems = this.countItems(delta);
      this.lastSyncAt = Date.now();

      return {
        success: true,
        syncedItems,
        conflicts: [],
      };
    } catch (error) {
      return {
        success: false,
        syncedItems: 0,
        conflicts: [],
        error: (error as Error).message,
      };
    }
  }

  async pull(): Promise<ParallelizationExport[]> {
    if (!this.git) {
      return [];
    }

    const deltas: ParallelizationExport[] = [];

    try {
      // Pull latest changes
      await this.pullChanges();

      const deltasPath = this.getDeltasPath();
      if (!existsSync(deltasPath)) {
        return deltas;
      }

      // Scan all Tachikoma directories
      const tachikomaDirs = readdirSync(deltasPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const tachikomaDir of tachikomaDirs) {
        const dirPath = join(deltasPath, tachikomaDir);
        const files = readdirSync(dirPath)
          .filter(f => f.endsWith('.json') && !f.endsWith('.imported.json'));

        for (const file of files) {
          const filePath = join(dirPath, file);
          try {
            const content = readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content) as ParallelizationExport;

            // Validate format
            if (data.format !== 'tachikoma-parallelize-delta') {
              console.error(`Skipping ${file}: invalid format`);
              continue;
            }

            // Skip if it's from ourselves
            if (this.currentTachikomaId && data.tachikomaId === this.currentTachikomaId) {
              this.markAsImported(filePath);
              continue;
            }

            deltas.push(data);
            this.markAsImported(filePath);
          } catch (error) {
            console.error(`Error processing ${file}:`, (error as Error).message);
          }
        }
      }

      // Commit imported markers
      if (deltas.length > 0) {
        await this.commitImportedMarkers();
        this.lastSyncAt = Date.now();
      }
    } catch (error) {
      console.error('Failed to pull deltas:', (error as Error).message);
    }

    return deltas;
  }

  async getStatus(): Promise<SyncStatus> {
    const connected = this.git !== null && this.initialized;
    let pendingChanges = 0;

    if (connected) {
      try {
        const deltasPath = this.getDeltasPath();
        if (existsSync(deltasPath)) {
          const tachikomaDirs = readdirSync(deltasPath, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

          for (const tachikomaDir of tachikomaDirs) {
            const dirPath = join(deltasPath, tachikomaDir);
            const files = readdirSync(dirPath)
              .filter(f => f.endsWith('.json') && !f.endsWith('.imported.json'));

            for (const file of files) {
              const filePath = join(dirPath, file);
              try {
                const content = readFileSync(filePath, 'utf-8');
                const data = JSON.parse(content) as ParallelizationExport;
                if (data.format === 'tachikoma-parallelize-delta' &&
                    (!this.currentTachikomaId || data.tachikomaId !== this.currentTachikomaId)) {
                  pendingChanges++;
                }
              } catch {
                // Skip invalid files
              }
            }
          }
        }
      } catch {
        // Directory read error
      }
    }

    return {
      connected,
      lastSyncAt: this.lastSyncAt,
      pendingChanges,
    };
  }

  /**
   * Manually trigger a git pull
   */
  async forcePull(): Promise<void> {
    if (!this.git) {
      throw new Error('Adapter not initialized');
    }
    await this.pullChanges();
  }

  /**
   * Manually trigger a git push
   */
  async forcePush(): Promise<void> {
    if (!this.git) {
      throw new Error('Adapter not initialized');
    }
    await this.git.push('origin', this.config.branch);
  }

  /**
   * Get the current git status
   */
  async getGitStatus(): Promise<{
    current: string | null;
    tracking: string | null;
    ahead: number;
    behind: number;
    modified: string[];
    staged: string[];
  }> {
    if (!this.git) {
      throw new Error('Adapter not initialized');
    }

    const status = await this.git.status();
    return {
      current: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      modified: status.modified,
      staged: status.staged,
    };
  }

  // Private methods

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return join(homedir(), filePath.slice(2));
    }
    return filePath;
  }

  private getDeltasPath(): string {
    return join(this.config.localPath, this.config.deltasDir);
  }

  private sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async cloneRepo(): Promise<void> {
    const git = simpleGit();
    await git.clone(this.config.repoUrl, this.config.localPath, [
      '--branch', this.config.branch,
      '--single-branch',
    ]);
  }

  private async ensureBranch(): Promise<void> {
    if (!this.git) return;

    const branches = await this.git.branchLocal();
    if (!branches.all.includes(this.config.branch)) {
      // Checkout the branch from remote
      try {
        await this.git.checkout(['-b', this.config.branch, `origin/${this.config.branch}`]);
      } catch {
        // Branch doesn't exist remotely, create it
        await this.git.checkout(['-b', this.config.branch]);
      }
    } else {
      await this.git.checkout(this.config.branch);
    }
  }

  private async pullChanges(): Promise<void> {
    if (!this.git) return;

    try {
      await this.git.fetch('origin');
      await this.git.pull('origin', this.config.branch, { '--rebase': 'true' });
    } catch (error) {
      // Handle merge conflicts or network errors gracefully
      console.error('Pull failed:', (error as Error).message);
    }
  }

  private markAsImported(filePath: string): void {
    try {
      renameSync(filePath, filePath.replace(/\.json$/, '.imported.json'));
    } catch (error) {
      console.error(`Failed to mark file as imported: ${filePath}`, error);
    }
  }

  private async commitImportedMarkers(): Promise<void> {
    if (!this.git) return;

    try {
      const status = await this.git.status();
      const importedFiles = status.renamed
        .filter(f => f.to?.endsWith('.imported.json'))
        .map(f => f.to as string);

      if (importedFiles.length > 0) {
        // Stage the renames
        await this.git.add('.');
        await this.git.commit(`sync: mark ${importedFiles.length} delta(s) as imported`);

        if (this.config.autoPush) {
          await this.git.push('origin', this.config.branch);
        }
      }
    } catch (error) {
      console.error('Failed to commit imported markers:', (error as Error).message);
    }
  }

  private countItems(delta: ParallelizationExport): number {
    return delta.delta.working.length +
           delta.delta.episodic.length +
           delta.delta.semantic.entities.length +
           delta.delta.semantic.relations.length;
  }
}
