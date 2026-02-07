/**
 * Migration 0003: Add valence and arousal columns for emotional tagging
 *
 * This adds emotional valence (-1.0 to +1.0) and arousal (0.0 to 1.0) fields
 * to episodic memories. Existing episodes are assigned values based on type.
 */

import type { Migration } from './types.js';

export const migration0003: Migration = {
  version: '0003',
  name: 'add_valence_arousal',

  up: (db) => {
    // Check if columns already exist
    const result = db.exec("PRAGMA table_info(episodic_memory)");
    if (result.length === 0) return;

    const columns = result[0].values.map(row => row[1] as string);

    if (!columns.includes('valence')) {
      db.run('ALTER TABLE episodic_memory ADD COLUMN valence REAL DEFAULT 0');
      console.log('[Migration 0003] Added valence column to episodic_memory');
    }

    if (!columns.includes('arousal')) {
      db.run('ALTER TABLE episodic_memory ADD COLUMN arousal REAL DEFAULT 0.5');
      console.log('[Migration 0003] Added arousal column to episodic_memory');
    }

    // Update existing episodes based on their type
    // error/incident = negative valence, high arousal
    // success/milestone = positive valence, high arousal
    // interaction = neutral valence, medium arousal
    db.run(`
      UPDATE episodic_memory
      SET valence = CASE
        WHEN type = 'error' THEN -0.7
        WHEN type = 'incident' THEN -0.5
        WHEN type = 'success' THEN 0.8
        WHEN type = 'milestone' THEN 0.9
        ELSE 0
      END,
      arousal = CASE
        WHEN type = 'error' THEN 0.8
        WHEN type = 'incident' THEN 0.7
        WHEN type = 'success' THEN 0.7
        WHEN type = 'milestone' THEN 0.9
        ELSE 0.5
      END
      WHERE valence = 0 AND arousal = 0.5
    `);
    console.log('[Migration 0003] Updated existing episodes with emotional valence/arousal');
  },
};
