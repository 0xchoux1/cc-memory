/**
 * MigrationRunner - Applies database migrations in order
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import type { Migration, MigrationRecord } from './types.js';

export class MigrationRunner {
  private db: SqlJsDatabase;
  private migrations: Migration[] = [];

  constructor(db: SqlJsDatabase) {
    this.db = db;
    this.ensureSchemaTable();
  }

  /**
   * Create schema_version table if it doesn't exist
   */
  private ensureSchemaTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Register a migration
   */
  register(migration: Migration): this {
    this.migrations.push(migration);
    return this;
  }

  /**
   * Register multiple migrations
   */
  registerAll(migrations: Migration[]): this {
    this.migrations.push(...migrations);
    return this;
  }

  /**
   * Get list of applied migrations
   */
  getAppliedMigrations(): MigrationRecord[] {
    const result = this.db.exec('SELECT version, name, applied_at FROM schema_version ORDER BY version');
    if (result.length === 0) return [];

    return result[0].values.map(row => ({
      version: row[0] as string,
      name: row[1] as string,
      appliedAt: row[2] as number,
    }));
  }

  /**
   * Get the current schema version
   */
  getCurrentVersion(): string | null {
    const applied = this.getAppliedMigrations();
    if (applied.length === 0) return null;
    return applied[applied.length - 1].version;
  }

  /**
   * Get pending migrations that haven't been applied
   */
  getPendingMigrations(): Migration[] {
    const applied = new Set(this.getAppliedMigrations().map(m => m.version));
    return this.migrations
      .filter(m => !applied.has(m.version))
      .sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Apply all pending migrations
   */
  migrate(): { applied: string[]; errors: Array<{ version: string; error: string }> } {
    const pending = this.getPendingMigrations();
    const applied: string[] = [];
    const errors: Array<{ version: string; error: string }> = [];

    for (const migration of pending) {
      try {
        this.db.run('BEGIN TRANSACTION');
        migration.up(this.db);
        this.db.run(
          'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, Date.now()]
        );
        this.db.run('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        this.db.run('ROLLBACK');
        errors.push({
          version: migration.version,
          error: error instanceof Error ? error.message : String(error),
        });
        break; // Stop on first error
      }
    }

    return { applied, errors };
  }

  /**
   * Rollback the last applied migration
   */
  rollback(): { rolledBack: string | null; error: string | null } {
    const applied = this.getAppliedMigrations();
    if (applied.length === 0) {
      return { rolledBack: null, error: 'No migrations to rollback' };
    }

    const lastApplied = applied[applied.length - 1];
    const migration = this.migrations.find(m => m.version === lastApplied.version);

    if (!migration) {
      return { rolledBack: null, error: `Migration ${lastApplied.version} not found` };
    }

    if (!migration.down) {
      return { rolledBack: null, error: `Migration ${lastApplied.version} does not support rollback` };
    }

    try {
      this.db.run('BEGIN TRANSACTION');
      migration.down(this.db);
      this.db.run('DELETE FROM schema_version WHERE version = ?', [migration.version]);
      this.db.run('COMMIT');
      return { rolledBack: migration.version, error: null };
    } catch (error) {
      this.db.run('ROLLBACK');
      return {
        rolledBack: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get migration status
   */
  status(): {
    current: string | null;
    pending: string[];
    applied: MigrationRecord[];
  } {
    return {
      current: this.getCurrentVersion(),
      pending: this.getPendingMigrations().map(m => m.version),
      applied: this.getAppliedMigrations(),
    };
  }
}
