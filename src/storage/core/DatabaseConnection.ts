/**
 * DatabaseConnection - Core database connection management
 * Handles initialization, persistence, and transactions for sql.js
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { StorageConfig } from '../../memory/types.js';

export class DatabaseConnection {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private dirty: boolean = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private inTransaction: boolean = false;
  private static readonly SAVE_DEBOUNCE_MS = 1000;

  constructor(config: StorageConfig) {
    this.dbPath = join(config.dataPath, 'memory.db');

    // Ensure data directory exists
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Start initialization
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

    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Wait for database initialization to complete
   */
  async ready(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * Get the underlying sql.js database instance
   */
  getDatabase(): SqlJsDatabase | null {
    return this.db;
  }

  /**
   * Check if the database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Mark the database as dirty and schedule a debounced write.
   */
  markDirty(): void {
    this.dirty = true;
    if (this.saveTimer || this.inTransaction) return; // don't save during transaction
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, DatabaseConnection.SAVE_DEBOUNCE_MS);
  }

  /**
   * Immediately persist the database to disk if dirty.
   */
  flush(): void {
    if (!this.db || !this.dirty) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
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
   * Begin a database transaction
   */
  beginTransaction(): void {
    if (!this.db || this.inTransaction) return;
    this.db.run('BEGIN TRANSACTION');
    this.inTransaction = true;
  }

  /**
   * Commit the current transaction
   */
  commit(): void {
    if (!this.db || !this.inTransaction) return;
    this.db.run('COMMIT');
    this.inTransaction = false;
    this.markDirty();
  }

  /**
   * Rollback the current transaction
   */
  rollback(): void {
    if (!this.db || !this.inTransaction) return;
    this.db.run('ROLLBACK');
    this.inTransaction = false;
  }

  /**
   * Execute a function within a transaction
   * Automatically commits on success, rolls back on error
   */
  transaction<T>(fn: () => T): T {
    this.beginTransaction();
    try {
      const result = fn();
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  /**
   * Execute an async function within a transaction
   */
  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.beginTransaction();
    try {
      const result = await fn();
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  /**
   * Check if currently in a transaction
   */
  isInTransaction(): boolean {
    return this.inTransaction;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.flush();
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Run a SQL statement
   */
  run(sql: string, params?: (string | number | null)[]): void {
    if (!this.db) return;
    this.db.run(sql, params);
  }

  /**
   * Execute a SQL query and return results
   */
  exec(sql: string, params?: (string | number | null)[]): { columns: string[]; values: unknown[][] }[] {
    if (!this.db) return [];
    return this.db.exec(sql, params);
  }

  /**
   * Get the number of rows modified by the last statement
   */
  getRowsModified(): number {
    if (!this.db) return 0;
    return this.db.getRowsModified();
  }
}
