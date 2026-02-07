/**
 * Migration 0002: Add stability field to episodic memory
 *
 * Adds a 'stability' column to episodic_memory table for SM-2 style
 * spaced repetition. Stability increases with each access, making
 * memories more resistant to decay.
 */

import type { Migration } from './types.js';

export const migration0002: Migration = {
  version: '0002',
  name: 'add_stability_field',
  up: (db) => {
    // Check if column already exists
    const result = db.exec("PRAGMA table_info(episodic_memory)");
    if (result.length > 0) {
      const columns = result[0].values.map(row => row[1] as string);
      if (columns.includes('stability')) {
        console.log('[Migration 0002] stability column already exists, skipping');
        return;
      }
    }

    db.run(`
      ALTER TABLE episodic_memory
      ADD COLUMN stability REAL DEFAULT 1.0
    `);

    console.log('[Migration 0002] Added stability column to episodic_memory');
  },
  down: (db) => {
    // SQLite doesn't support DROP COLUMN directly
    // For a real rollback, we'd need to recreate the table
    // For now, we just leave the column (it won't hurt anything)
    console.log('[Migration 0002] Rollback: stability column left in place (SQLite limitation)');
  },
};
