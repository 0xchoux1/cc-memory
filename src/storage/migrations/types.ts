/**
 * Migration types and interfaces
 */

import type { Database as SqlJsDatabase } from 'sql.js';

export interface Migration {
  /** Unique version identifier (e.g., '0001', '0002') */
  version: string;
  /** Human-readable name for the migration */
  name: string;
  /** Apply the migration */
  up: (db: SqlJsDatabase) => void;
  /** Rollback the migration (optional) */
  down?: (db: SqlJsDatabase) => void;
}

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: number;
}
