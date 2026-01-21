/**
 * CloudSyncAdapter - Cloud storage sync adapter for cc-memory
 * Syncs memories via cloud-synced directories (Dropbox, Google Drive, iCloud, etc.)
 * Extends FileSyncAdapter with polling-based file watching
 */

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import type { ParallelizationExport, TachikomaId } from '../../memory/types.js';
import type {
  SyncAdapter,
  SyncAdapterType,
  SyncResult,
  SyncStatus,
  CloudSyncAdapterConfig,
} from '../types.js';

export class CloudSyncAdapter implements SyncAdapter {
  readonly type: SyncAdapterType = 'cloud';
  readonly name: string;

  private syncDir: string;
  private watchInterval: number;
  private currentTachikomaId?: TachikomaId;
  private lastSyncAt?: number;
  private onSyncCallback?: (delta: ParallelizationExport) => void;
  private watchTimer?: ReturnType<typeof setInterval>;
  private knownFiles: Set<string> = new Set();

  constructor(config: CloudSyncAdapterConfig) {
    this.name = config.name || 'cloud';
    this.syncDir = config.syncDir;
    this.watchInterval = config.watchInterval ?? 5000; // Default: 5 seconds
  }

  /**
   * Set the current Tachikoma ID to filter out self-exports
   */
  setTachikomaId(id: TachikomaId): void {
    this.currentTachikomaId = id;
  }

  async initialize(): Promise<void> {
    // Ensure sync directory exists
    if (!existsSync(this.syncDir)) {
      mkdirSync(this.syncDir, { recursive: true });
    }

    // Initialize known files list
    this.updateKnownFiles();

    // Start file watching if callback is set
    if (this.onSyncCallback) {
      this.startWatching();
    }
  }

  async close(): Promise<void> {
    this.stopWatching();
  }

  async push(delta: ParallelizationExport): Promise<SyncResult> {
    try {
      const safeId = this.sanitizeFilenamePart(delta.tachikomaId);
      if (!safeId) {
        throw new Error('Invalid Tachikoma ID for filename');
      }
      const filename = `${safeId}_${delta.exportedAt}.json`;
      const filepath = join(this.syncDir, filename);

      writeFileSync(filepath, JSON.stringify(delta, null, 2), 'utf-8');

      // Add to known files to avoid re-processing our own export
      this.knownFiles.add(filename);

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
    const deltas: ParallelizationExport[] = [];

    if (!existsSync(this.syncDir)) {
      return deltas;
    }

    // Find all .json files (excluding .imported files)
    const files = readdirSync(this.syncDir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.imported.json'));

    for (const file of files) {
      const filePath = join(this.syncDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as ParallelizationExport;

        // Validate format
        if (data.format !== 'tachikoma-parallelize-delta') {
          console.error(`[CloudSync] Skipping ${file}: invalid format`);
          continue;
        }

        // Skip if it's from ourselves
        if (this.currentTachikomaId && data.tachikomaId === this.currentTachikomaId) {
          // Rename to .imported anyway to avoid reprocessing
          this.markAsImported(filePath);
          continue;
        }

        deltas.push(data);
        this.markAsImported(filePath);

        // Update known files
        this.knownFiles.add(file.replace(/\.json$/, '.imported.json'));
      } catch (error) {
        console.error(`[CloudSync] Error processing ${file}:`, (error as Error).message);
      }
    }

    if (deltas.length > 0) {
      this.lastSyncAt = Date.now();
    }

    return deltas;
  }

  async getStatus(): Promise<SyncStatus> {
    const connected = existsSync(this.syncDir);
    let pendingChanges = 0;

    if (connected) {
      try {
        const files = readdirSync(this.syncDir)
          .filter(f => f.endsWith('.json') && !f.endsWith('.imported.json'));

        // Count files not from ourselves
        for (const file of files) {
          const filePath = join(this.syncDir, file);
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

  onSync(callback: (delta: ParallelizationExport) => void): void {
    this.onSyncCallback = callback;
    // Start watching if already initialized
    if (existsSync(this.syncDir)) {
      this.startWatching();
    }
  }

  /**
   * Start polling for new files
   */
  private startWatching(): void {
    if (this.watchTimer) {
      return; // Already watching
    }

    this.watchTimer = setInterval(() => {
      this.checkForNewFiles();
    }, this.watchInterval);
  }

  /**
   * Stop polling for new files
   */
  private stopWatching(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = undefined;
    }
  }

  /**
   * Check for new files and trigger callback
   */
  private checkForNewFiles(): void {
    if (!existsSync(this.syncDir) || !this.onSyncCallback) {
      return;
    }

    try {
      const files = readdirSync(this.syncDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.imported.json'));

      for (const file of files) {
        if (this.knownFiles.has(file)) {
          continue; // Already processed
        }

        const filePath = join(this.syncDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content) as ParallelizationExport;

          // Validate format
          if (data.format !== 'tachikoma-parallelize-delta') {
            this.knownFiles.add(file);
            continue;
          }

          // Skip if it's from ourselves
          if (this.currentTachikomaId && data.tachikomaId === this.currentTachikomaId) {
            this.markAsImported(filePath);
            this.knownFiles.add(file.replace(/\.json$/, '.imported.json'));
            continue;
          }

          // Trigger callback
          this.onSyncCallback(data);
          this.markAsImported(filePath);
          this.knownFiles.add(file.replace(/\.json$/, '.imported.json'));
          this.lastSyncAt = Date.now();
        } catch (error) {
          console.error(`[CloudSync] Error processing new file ${file}:`, (error as Error).message);
          this.knownFiles.add(file); // Mark as known to avoid repeated errors
        }
      }
    } catch (error) {
      console.error('[CloudSync] Error checking for new files:', (error as Error).message);
    }
  }

  /**
   * Update the list of known files
   */
  private updateKnownFiles(): void {
    if (!existsSync(this.syncDir)) {
      return;
    }

    try {
      const files = readdirSync(this.syncDir)
        .filter(f => f.endsWith('.json'));

      for (const file of files) {
        this.knownFiles.add(file);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Mark a file as imported by renaming it
   */
  private markAsImported(filePath: string): void {
    try {
      renameSync(filePath, filePath.replace(/\.json$/, '.imported.json'));
    } catch (error) {
      console.error(`[CloudSync] Failed to mark file as imported: ${filePath}`, error);
    }
  }

  /**
   * Sanitize a string for use in filenames
   */
  private sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Count items in a delta
   */
  private countItems(delta: ParallelizationExport): number {
    return delta.delta.working.length +
           delta.delta.episodic.length +
           delta.delta.semantic.entities.length +
           delta.delta.semantic.relations.length;
  }

  /**
   * Get list of imported files
   */
  getImportedFiles(): string[] {
    if (!existsSync(this.syncDir)) {
      return [];
    }

    return readdirSync(this.syncDir)
      .filter(f => f.endsWith('.imported.json'))
      .map(f => join(this.syncDir, f));
  }

  /**
   * Clean up old imported files
   */
  cleanupImportedFiles(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    const files = this.getImportedFiles();
    let cleaned = 0;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as ParallelizationExport;

        if (data.exportedAt && (now - data.exportedAt) > maxAgeMs) {
          // Delete old files
          const { unlinkSync } = require('fs');
          unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // Skip files that can't be read/parsed
      }
    }

    return cleaned;
  }
}
