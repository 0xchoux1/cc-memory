/**
 * DatabaseConnection - Manages the sql.js database connection
 *
 * This class encapsulates all database initialization, connection management,
 * transaction support, and persistence operations.
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface DatabaseConfig {
  dataPath: string;
  /** Interval for auto-flush in ms (default: 2000) */
  flushInterval?: number;
}

export type SqlParams = (string | number | null | Uint8Array)[];

export interface QueryResult {
  columns: string[];
  values: unknown[][];
}

export class DatabaseConnection {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private dirty: boolean = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInterval: number;
  private initialized: boolean = false;
  private initPromise: Promise<void>;

  constructor(config: DatabaseConfig) {
    this.dbPath = join(config.dataPath, 'memory.db');
    this.flushInterval = config.flushInterval ?? 2000;

    // Ensure data directory exists
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    // Try to load existing database
    if (existsSync(this.dbPath)) {
      try {
        const buffer = readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
      } catch {
        // Create new database if loading fails
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    // Start auto-flush timer
    this.startFlushTimer();

    this.initialized = true;
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      if (this.dirty) {
        this.flush();
      }
    }, this.flushInterval);
  }

  /**
   * Wait for database initialization to complete
   */
  async ready(): Promise<void> {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  /**
   * Get the underlying sql.js database (for migrations and schema setup)
   */
  getDatabase(): SqlJsDatabase | null {
    return this.db;
  }

  /**
   * Check if database is initialized
   */
  isReady(): boolean {
    return this.initialized && this.db !== null;
  }

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params?: SqlParams): void {
    if (!this.db) return;
    this.db.run(sql, params);
    this.markDirty();
  }

  /**
   * Execute a SQL query and return results
   */
  exec(sql: string, params?: SqlParams): QueryResult[] {
    if (!this.db) return [];
    return this.db.exec(sql, params) as QueryResult[];
  }

  /**
   * Get the number of rows modified by the last statement
   */
  getRowsModified(): number {
    if (!this.db) return 0;
    return this.db.getRowsModified();
  }

  /**
   * Mark database as dirty (needs to be flushed)
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Flush database to disk immediately
   */
  flush(): void {
    if (!this.db || !this.dirty) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  /**
   * Execute operations within a transaction
   * If the callback throws, the transaction is rolled back
   */
  transaction<T>(callback: () => T): T {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.run('BEGIN TRANSACTION');
    try {
      const result = callback();
      this.db.run('COMMIT');
      this.markDirty();
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.db) {
      this.flush();
      this.db.close();
      this.db = null;
    }

    this.initialized = false;
  }
}
