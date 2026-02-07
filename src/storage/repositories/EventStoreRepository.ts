/**
 * EventStoreRepository - Persists memory events for event sourcing
 *
 * Features:
 * - Append-only event log
 * - Query by type, time range, session
 * - Support for event replay
 * - Automatic cleanup of old events
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type { AllMemoryEvents, MemoryEventType } from '../../events/types.js';

export interface StoredEvent {
  id: string;
  type: MemoryEventType;
  timestamp: number;
  sessionId?: string;
  payload: string; // JSON serialized event
}

export interface EventQuery {
  type?: MemoryEventType;
  types?: MemoryEventType[];
  sessionId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export class EventStoreRepository extends BaseRepository {
  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize event store table
   */
  createTables(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    db.run(`
      CREATE TABLE IF NOT EXISTS event_store (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT,
        payload TEXT NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON event_store(type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON event_store(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_session ON event_store(session_id)`);
  }

  /**
   * Append an event to the store
   */
  append(event: AllMemoryEvents): string {
    const id = `evt_${event.timestamp}_${Math.random().toString(36).substr(2, 9)}`;

    this.run(`
      INSERT INTO event_store (id, type, timestamp, session_id, payload)
      VALUES (?, ?, ?, ?, ?)
    `, [
      id,
      event.type,
      event.timestamp,
      event.sessionId || null,
      JSON.stringify(event),
    ]);

    return id;
  }

  /**
   * Append multiple events (batch)
   */
  appendMany(events: AllMemoryEvents[]): string[] {
    return events.map(event => this.append(event));
  }

  /**
   * Query events
   */
  query(query: EventQuery): AllMemoryEvents[] {
    let sql = 'SELECT payload FROM event_store WHERE 1=1';
    const params: (string | number)[] = [];

    if (query.type) {
      sql += ' AND type = ?';
      params.push(query.type);
    }

    if (query.types && query.types.length > 0) {
      const placeholders = query.types.map(() => '?').join(', ');
      sql += ` AND type IN (${placeholders})`;
      params.push(...query.types);
    }

    if (query.sessionId) {
      sql += ' AND session_id = ?';
      params.push(query.sessionId);
    }

    if (query.since) {
      sql += ' AND timestamp >= ?';
      params.push(query.since);
    }

    if (query.until) {
      sql += ' AND timestamp <= ?';
      params.push(query.until);
    }

    sql += ' ORDER BY timestamp ASC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => {
      return this.safeJsonParse<AllMemoryEvents>(row[0] as string, {} as AllMemoryEvents);
    }).filter(e => e.type); // Filter out any parse failures
  }

  /**
   * Get event count
   */
  count(query?: Omit<EventQuery, 'limit' | 'offset'>): number {
    let sql = 'SELECT COUNT(*) FROM event_store WHERE 1=1';
    const params: (string | number)[] = [];

    if (query?.type) {
      sql += ' AND type = ?';
      params.push(query.type);
    }

    if (query?.sessionId) {
      sql += ' AND session_id = ?';
      params.push(query.sessionId);
    }

    if (query?.since) {
      sql += ' AND timestamp >= ?';
      params.push(query.since);
    }

    if (query?.until) {
      sql += ' AND timestamp <= ?';
      params.push(query.until);
    }

    const result = this.exec(sql, params);
    if (result.length === 0) return 0;

    return result[0].values[0][0] as number;
  }

  /**
   * Get the latest event of a specific type
   */
  getLatest(type: MemoryEventType): AllMemoryEvents | null {
    const result = this.exec(
      'SELECT payload FROM event_store WHERE type = ? ORDER BY timestamp DESC LIMIT 1',
      [type]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.safeJsonParse<AllMemoryEvents>(result[0].values[0][0] as string, null as unknown as AllMemoryEvents);
  }

  /**
   * Delete events older than a certain timestamp
   */
  deleteOlderThan(timestamp: number): number {
    this.run('DELETE FROM event_store WHERE timestamp < ?', [timestamp]);
    return this.getRowsModified();
  }

  /**
   * Delete events by session
   */
  deleteBySession(sessionId: string): number {
    this.run('DELETE FROM event_store WHERE session_id = ?', [sessionId]);
    return this.getRowsModified();
  }

  /**
   * Get event statistics
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    const totalResult = this.exec('SELECT COUNT(*) FROM event_store');
    const totalEvents = totalResult[0]?.values[0]?.[0] as number || 0;

    const typeResult = this.exec('SELECT type, COUNT(*) FROM event_store GROUP BY type');
    const eventsByType: Record<string, number> = {};
    if (typeResult.length > 0) {
      for (const row of typeResult[0].values) {
        eventsByType[row[0] as string] = row[1] as number;
      }
    }

    const timestampResult = this.exec(
      'SELECT MIN(timestamp), MAX(timestamp) FROM event_store'
    );
    const oldestTimestamp = timestampResult[0]?.values[0]?.[0] as number | null;
    const newestTimestamp = timestampResult[0]?.values[0]?.[1] as number | null;

    return { totalEvents, eventsByType, oldestTimestamp, newestTimestamp };
  }
}
