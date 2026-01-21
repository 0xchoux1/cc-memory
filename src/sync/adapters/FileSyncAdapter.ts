/**
 * FileSyncAdapter - File-based sync adapter for cc-memory
 * Syncs memories via a shared directory (local filesystem, NFS, etc.)
 */

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import type { ParallelizationExport, TachikomaId } from '../../memory/types.js';
import type {
  SyncAdapter,
  SyncAdapterType,
  SyncResult,
  SyncStatus,
  FileSyncAdapterConfig,
} from '../types.js';

export class FileSyncAdapter implements SyncAdapter {
  readonly type: SyncAdapterType = 'file';
  readonly name: string;

  private syncDir: string;
  private currentTachikomaId?: TachikomaId;
  private lastSyncAt?: number;
  private onSyncCallback?: (delta: ParallelizationExport) => void;

  constructor(config: FileSyncAdapterConfig) {
    this.name = config.name || 'file';
    this.syncDir = config.syncDir;
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
  }

  async close(): Promise<void> {
    // No cleanup needed for file-based adapter
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
          console.error(`Skipping ${file}: invalid format`);
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
      } catch (error) {
        console.error(`Error processing ${file}:`, (error as Error).message);
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

  /**
   * Mark a file as imported by renaming it
   */
  private markAsImported(filePath: string): void {
    try {
      renameSync(filePath, filePath.replace(/\.json$/, '.imported.json'));
    } catch (error) {
      console.error(`Failed to mark file as imported: ${filePath}`, error);
    }
  }

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
}
