/**
 * WorkingMemoryRepository - Handles working memory storage operations
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type {
  WorkingMemoryItem,
  WorkingMemoryFilter,
} from '../../memory/types.js';

export class WorkingMemoryRepository extends BaseRepository {
  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize the working memory table
   */
  createTable(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    db.run(`
      CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        session_id TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_working_key ON working_memory(key)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_working_expires ON working_memory(expires_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id)`);
  }

  /**
   * Store or update a working memory item
   */
  set(item: WorkingMemoryItem): void {
    this.run(`
      INSERT OR REPLACE INTO working_memory
      (id, key, type, value, session_id, priority, tags, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.id,
      item.key,
      item.type,
      JSON.stringify(item.value),
      item.metadata.sessionId,
      item.metadata.priority,
      JSON.stringify(item.tags),
      item.metadata.createdAt,
      item.metadata.updatedAt,
      item.metadata.expiresAt,
    ]);
  }

  /**
   * Get a working memory item by key
   */
  get(key: string): WorkingMemoryItem | null {
    const result = this.exec(`
      SELECT * FROM working_memory WHERE key = ? AND expires_at > ?
    `, [key, Date.now()]);

    if (result.length === 0 || result[0].values.length === 0) return null;

    return this.rowToItem(result[0].columns, result[0].values[0]);
  }

  /**
   * Delete a working memory item by key
   */
  delete(key: string): boolean {
    this.run('DELETE FROM working_memory WHERE key = ?', [key]);
    return this.getRowsModified() > 0;
  }

  /**
   * List working memory items with optional filter
   */
  list(filter?: WorkingMemoryFilter): WorkingMemoryItem[] {
    let sql = 'SELECT * FROM working_memory WHERE 1=1';
    const params: (string | number)[] = [];

    if (!filter?.includeExpired) {
      sql += ' AND expires_at > ?';
      params.push(Date.now());
    }

    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }

    if (filter?.sessionId) {
      sql += ' AND session_id = ?';
      params.push(filter.sessionId);
    }

    if (filter?.tags && filter.tags.length > 0) {
      const tagConditions = filter.tags.map(() =>
        `EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)`
      ).join(' OR ');
      sql += ` AND (${tagConditions})`;
      params.push(...filter.tags);
    }

    sql += ' ORDER BY updated_at DESC';

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToItem(result[0].columns, row));
  }

  /**
   * Clear expired items
   */
  clearExpired(): number {
    this.run('DELETE FROM working_memory WHERE expires_at <= ?', [Date.now()]);
    return this.getRowsModified();
  }

  /**
   * Clear all items
   */
  clearAll(): number {
    this.run('DELETE FROM working_memory');
    return this.getRowsModified();
  }

  /**
   * Convert a database row to a WorkingMemoryItem
   */
  private rowToItem(columns: string[], row: unknown[]): WorkingMemoryItem {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      key: obj.key as string,
      type: obj.type as WorkingMemoryItem['type'],
      value: this.safeJsonParse(obj.value as string, null),
      metadata: {
        sessionId: obj.session_id as string,
        priority: (obj.priority || 'medium') as WorkingMemoryItem['metadata']['priority'],
        createdAt: obj.created_at as number,
        updatedAt: obj.updated_at as number,
        expiresAt: obj.expires_at as number,
      },
      tags: this.safeJsonParse(obj.tags as string, []),
    };
  }
}
