/**
 * TachikomaRepository - Handles Tachikoma parallelization storage operations
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type {
  TachikomaId,
  TachikomaProfile,
  SyncVector,
  ConflictRecord,
  ConflictStrategy,
  SyncHistoryEntry,
  SyncType,
} from '../../memory/types.js';
import { v7 as uuidv7 } from 'uuid';

export class TachikomaRepository extends BaseRepository {
  private activeTachikomaId: TachikomaId | null = null;

  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize Tachikoma tables
   */
  createTables(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    // Tachikoma profile table
    db.run(`
      CREATE TABLE IF NOT EXISTS tachikoma_profile (
        id TEXT PRIMARY KEY,
        name TEXT,
        sync_seq INTEGER DEFAULT 0,
        sync_vector TEXT DEFAULT '{}',
        last_sync_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    // Sync history table
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_history (
        id TEXT PRIMARY KEY,
        remote_tachikoma_id TEXT NOT NULL,
        remote_tachikoma_name TEXT,
        sync_type TEXT NOT NULL,
        items_count INTEGER NOT NULL,
        conflicts_count INTEGER DEFAULT 0,
        sync_vector TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Conflicts table
    db.run(`
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        local_item TEXT NOT NULL,
        remote_item TEXT NOT NULL,
        strategy TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolution TEXT
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_conflicts_resolved ON conflicts(resolved_at)`);
  }

  /**
   * Get active Tachikoma ID
   */
  getActiveTachikomaId(): TachikomaId | null {
    return this.activeTachikomaId;
  }

  /**
   * Initialize or get Tachikoma profile
   */
  init(id?: TachikomaId, name?: string): TachikomaProfile {
    // Check for existing profile
    const existing = this.getProfile();
    if (existing) {
      this.activeTachikomaId = existing.id;
      return existing;
    }

    // Create new profile
    const tachikomaId = id || `tachikoma_${uuidv7()}`;
    const now = Date.now();

    const profile: TachikomaProfile = {
      id: tachikomaId,
      name,
      syncSeq: 0,
      syncVector: { [tachikomaId]: 0 },
      createdAt: now,
    };

    this.run(`
      INSERT INTO tachikoma_profile
      (id, name, sync_seq, sync_vector, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [
      profile.id,
      profile.name || null,
      profile.syncSeq,
      JSON.stringify(profile.syncVector),
      profile.createdAt,
    ]);

    this.activeTachikomaId = tachikomaId;
    return profile;
  }

  /**
   * Get Tachikoma profile
   */
  getProfile(): TachikomaProfile | null {
    const result = this.exec('SELECT * FROM tachikoma_profile LIMIT 1');
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToProfile(result[0].columns, result[0].values[0]);
  }

  /**
   * Get Tachikoma profile by name
   */
  getProfileByName(name: string): TachikomaProfile | null {
    const result = this.exec('SELECT * FROM tachikoma_profile WHERE name = ?', [name]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToProfile(result[0].columns, result[0].values[0]);
  }

  /**
   * Update Tachikoma profile
   */
  updateProfile(updates: Partial<Pick<TachikomaProfile, 'name' | 'syncSeq' | 'syncVector' | 'lastSyncAt'>>): void {
    const profile = this.getProfile();
    if (!profile) return;

    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      params.push(updates.name);
    }
    if (updates.syncSeq !== undefined) {
      fields.push('sync_seq = ?');
      params.push(updates.syncSeq);
    }
    if (updates.syncVector !== undefined) {
      fields.push('sync_vector = ?');
      params.push(JSON.stringify(updates.syncVector));
    }
    if (updates.lastSyncAt !== undefined) {
      fields.push('last_sync_at = ?');
      params.push(updates.lastSyncAt);
    }

    if (fields.length > 0) {
      params.push(profile.id);
      this.run(`UPDATE tachikoma_profile SET ${fields.join(', ')} WHERE id = ?`, params);
    }
  }

  /**
   * Increment and get next sync sequence number
   */
  nextSyncSeq(): number {
    const profile = this.getProfile();
    if (!profile) return 0;

    const newSeq = profile.syncSeq + 1;
    this.updateProfile({ syncSeq: newSeq });
    return newSeq;
  }

  // ============================================================================
  // Sync History Operations
  // ============================================================================

  /**
   * Add a sync history entry
   */
  addSyncHistory(entry: Omit<SyncHistoryEntry, 'id' | 'createdAt'>): SyncHistoryEntry {
    const now = Date.now();
    const id = `sync_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const fullEntry: SyncHistoryEntry = {
      id,
      createdAt: now,
      ...entry,
    };

    this.run(`
      INSERT INTO sync_history
      (id, remote_tachikoma_id, remote_tachikoma_name, sync_type, items_count, conflicts_count, sync_vector, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      fullEntry.id,
      fullEntry.remoteTachikomaId,
      fullEntry.remoteTachikomaName || null,
      fullEntry.syncType,
      fullEntry.itemsCount,
      fullEntry.conflictsCount,
      JSON.stringify(fullEntry.syncVector),
      fullEntry.createdAt,
    ]);

    return fullEntry;
  }

  /**
   * List sync history
   */
  listSyncHistory(limit: number = 10): SyncHistoryEntry[] {
    const result = this.exec(
      'SELECT * FROM sync_history ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToSyncHistory(result[0].columns, row));
  }

  // ============================================================================
  // Conflict Operations
  // ============================================================================

  /**
   * Add a conflict record
   */
  addConflict(conflict: Omit<ConflictRecord, 'id' | 'createdAt'>): ConflictRecord {
    const now = Date.now();
    const id = `conflict_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const fullConflict: ConflictRecord = {
      id,
      createdAt: now,
      ...conflict,
    };

    this.run(`
      INSERT INTO conflicts
      (id, memory_type, local_item, remote_item, strategy, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      fullConflict.id,
      fullConflict.memoryType,
      JSON.stringify(fullConflict.localItem),
      JSON.stringify(fullConflict.remoteItem),
      fullConflict.strategy,
      fullConflict.createdAt,
    ]);

    return fullConflict;
  }

  /**
   * List conflicts
   */
  listConflicts(unresolvedOnly: boolean = true): ConflictRecord[] {
    let sql = 'SELECT * FROM conflicts';
    if (unresolvedOnly) {
      sql += ' WHERE resolved_at IS NULL';
    }
    sql += ' ORDER BY created_at DESC';

    const result = this.exec(sql);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToConflict(result[0].columns, row));
  }

  /**
   * Resolve a conflict
   */
  resolveConflict(id: string, resolution: 'local' | 'remote' | 'merged'): boolean {
    const now = Date.now();
    this.run(
      'UPDATE conflicts SET resolved_at = ?, resolution = ? WHERE id = ?',
      [now, resolution, id]
    );
    return this.getRowsModified() > 0;
  }

  /**
   * Get a conflict by ID
   */
  getConflict(id: string): ConflictRecord | null {
    const result = this.exec('SELECT * FROM conflicts WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToConflict(result[0].columns, result[0].values[0]);
  }

  // ============================================================================
  // Row Conversion Helpers
  // ============================================================================

  private rowToProfile(columns: string[], row: unknown[]): TachikomaProfile {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      name: obj.name as string | undefined,
      syncSeq: obj.sync_seq as number,
      syncVector: this.safeJsonParse<SyncVector>(obj.sync_vector as string, {}),
      lastSyncAt: obj.last_sync_at as number | undefined,
      createdAt: obj.created_at as number,
    };
  }

  private rowToSyncHistory(columns: string[], row: unknown[]): SyncHistoryEntry {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      remoteTachikomaId: obj.remote_tachikoma_id as string,
      remoteTachikomaName: obj.remote_tachikoma_name as string | undefined,
      syncType: obj.sync_type as SyncType,
      itemsCount: obj.items_count as number,
      conflictsCount: obj.conflicts_count as number,
      syncVector: this.safeJsonParse<SyncVector>(obj.sync_vector as string, {}),
      createdAt: obj.created_at as number,
    };
  }

  private rowToConflict(columns: string[], row: unknown[]): ConflictRecord {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      memoryType: obj.memory_type as ConflictRecord['memoryType'],
      localItem: this.safeJsonParse(obj.local_item as string, null),
      remoteItem: this.safeJsonParse(obj.remote_item as string, null),
      strategy: obj.strategy as ConflictStrategy,
      createdAt: obj.created_at as number,
      resolvedAt: obj.resolved_at as number | undefined,
      resolution: obj.resolution as ConflictRecord['resolution'],
    };
  }
}
