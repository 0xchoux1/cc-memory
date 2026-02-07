/**
 * Migration 0001: Initial schema baseline
 *
 * This is a baseline migration that marks the starting point for schema versioning.
 * The actual tables are created by SqliteStorage.createTables() for backward compatibility.
 * Future migrations will modify the schema from this baseline.
 */

import type { Migration } from './types.js';

export const migration0001: Migration = {
  version: '0001',
  name: 'initial_schema',
  up: (_db) => {
    // Baseline migration - tables already exist from createTables()
    // This migration just marks the schema version
    console.log('[Migration 0001] Marking initial schema baseline');
  },
  down: (_db) => {
    // Cannot rollback initial schema
    throw new Error('Cannot rollback initial schema migration');
  },
};
