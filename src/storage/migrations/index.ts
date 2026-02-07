/**
 * Database migrations module
 */

export type { Migration, MigrationRecord } from './types.js';
export { MigrationRunner } from './MigrationRunner.js';

// Import all migrations
import { migration0001 } from './0001_initial_schema.js';
import { migration0002 } from './0002_add_stability_field.js';

/**
 * All registered migrations in order
 */
export const allMigrations = [
  migration0001,
  migration0002,
];
