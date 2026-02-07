/**
 * Event Sourcing tests (A3)
 *
 * Tests the event sourcing implementation:
 * - Event persistence to SQLite
 * - Event replay
 * - Audit log queries
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import { DatabaseConnection } from '../../src/storage/DatabaseConnection.js';
import { EventStoreRepository } from '../../src/storage/repositories/EventStoreRepository.js';
import { PersistentEventEmitter } from '../../src/events/PersistentEventEmitter.js';
import type { EpisodeCreatedEvent, WorkingMemoryCreatedEvent } from '../../src/events/types.js';

describe('EventSourcing', () => {
  let connection: DatabaseConnection;
  const testDir = join(tmpdir(), 'cc-memory-event-test-' + Date.now());

  beforeEach(async () => {
    connection = new DatabaseConnection({ dataPath: testDir });
    await connection.ready();
  });

  afterEach(() => {
    connection.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('EventStoreRepository', () => {
    let eventStore: EventStoreRepository;

    beforeEach(() => {
      eventStore = new EventStoreRepository(connection);
      eventStore.createTables();
    });

    it('should append and query events', () => {
      const event: EpisodeCreatedEvent = {
        type: 'episode.created',
        timestamp: Date.now(),
        sessionId: 'test-session',
        episode: {
          id: 'ep-1',
          timestamp: Date.now(),
          type: 'success',
          summary: 'Test episode',
          details: 'Test details',
          context: { sessionId: 'test-session' },
          relatedEpisodes: [],
          relatedEntities: [],
          importance: 5,
          accessCount: 0,
          lastAccessed: Date.now(),
          tags: ['test'],
        },
      };

      const id = eventStore.append(event);
      expect(id).toBeDefined();
      expect(id).toContain('evt_');

      const events = eventStore.query({});
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('episode.created');
    });

    it('should query events by type', () => {
      // Add multiple event types
      eventStore.append({
        type: 'episode.created',
        timestamp: Date.now(),
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'working_memory.created',
        timestamp: Date.now(),
        item: {} as WorkingMemoryCreatedEvent['item'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: Date.now(),
        episode: {} as EpisodeCreatedEvent['episode'],
      });

      const episodeEvents = eventStore.query({ type: 'episode.created' });
      expect(episodeEvents).toHaveLength(2);

      const workingEvents = eventStore.query({ type: 'working_memory.created' });
      expect(workingEvents).toHaveLength(1);
    });

    it('should query events by time range', () => {
      const now = Date.now();

      eventStore.append({
        type: 'episode.created',
        timestamp: now - 3600000, // 1 hour ago
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: now - 1800000, // 30 min ago
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: now,
        episode: {} as EpisodeCreatedEvent['episode'],
      });

      const recentEvents = eventStore.query({ since: now - 2000000 }); // Last ~33 min
      expect(recentEvents).toHaveLength(2);

      const oldEvents = eventStore.query({ until: now - 2000000 });
      expect(oldEvents).toHaveLength(1);
    });

    it('should query events by session', () => {
      eventStore.append({
        type: 'episode.created',
        timestamp: Date.now(),
        sessionId: 'session-1',
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: Date.now(),
        sessionId: 'session-2',
        episode: {} as EpisodeCreatedEvent['episode'],
      });

      const session1Events = eventStore.query({ sessionId: 'session-1' });
      expect(session1Events).toHaveLength(1);
    });

    it('should count events', () => {
      for (let i = 0; i < 5; i++) {
        eventStore.append({
          type: 'episode.created',
          timestamp: Date.now() + i,
          episode: {} as EpisodeCreatedEvent['episode'],
        });
      }

      expect(eventStore.count()).toBe(5);
      expect(eventStore.count({ type: 'episode.created' })).toBe(5);
      expect(eventStore.count({ type: 'working_memory.created' })).toBe(0);
    });

    it('should get latest event', () => {
      eventStore.append({
        type: 'episode.created',
        timestamp: 1000,
        episode: { id: 'ep-1' } as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: 2000,
        episode: { id: 'ep-2' } as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: 3000,
        episode: { id: 'ep-3' } as EpisodeCreatedEvent['episode'],
      });

      const latest = eventStore.getLatest('episode.created') as EpisodeCreatedEvent;
      expect(latest).toBeDefined();
      expect(latest.episode.id).toBe('ep-3');
    });

    it('should delete old events', () => {
      const now = Date.now();

      eventStore.append({
        type: 'episode.created',
        timestamp: now - 86400000 * 2, // 2 days ago
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: now,
        episode: {} as EpisodeCreatedEvent['episode'],
      });

      const deleted = eventStore.deleteOlderThan(now - 86400000); // Delete older than 1 day
      expect(deleted).toBe(1);
      expect(eventStore.count()).toBe(1);
    });

    it('should get event statistics', () => {
      eventStore.append({
        type: 'episode.created',
        timestamp: 1000,
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'episode.created',
        timestamp: 2000,
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      eventStore.append({
        type: 'working_memory.created',
        timestamp: 3000,
        item: {} as WorkingMemoryCreatedEvent['item'],
      });

      const stats = eventStore.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.eventsByType['episode.created']).toBe(2);
      expect(stats.eventsByType['working_memory.created']).toBe(1);
      expect(stats.oldestTimestamp).toBe(1000);
      expect(stats.newestTimestamp).toBe(3000);
    });
  });

  describe('PersistentEventEmitter', () => {
    let emitter: PersistentEventEmitter;

    beforeEach(() => {
      emitter = new PersistentEventEmitter(connection, {
        persist: true,
        cleanupOnStart: false,
      });
    });

    it('should emit and persist events', () => {
      const receivedEvents: unknown[] = [];
      emitter.on('episode.created', (event) => {
        receivedEvents.push(event);
      });

      emitter.emit<EpisodeCreatedEvent>({
        type: 'episode.created',
        sessionId: 'test-session',
        episode: {
          id: 'ep-1',
          timestamp: Date.now(),
          type: 'success',
          summary: 'Test',
          details: 'Test details',
          context: { sessionId: 'test-session' },
          relatedEpisodes: [],
          relatedEntities: [],
          importance: 5,
          accessCount: 0,
          lastAccessed: Date.now(),
          tags: [],
        },
      });

      // Event should be received by listener
      expect(receivedEvents).toHaveLength(1);

      // Event should be persisted
      const persistedEvents = emitter.queryEvents({});
      expect(persistedEvents).toHaveLength(1);
    });

    it('should replay events', () => {
      // Emit some events
      for (let i = 0; i < 3; i++) {
        emitter.emit<EpisodeCreatedEvent>({
          type: 'episode.created',
          timestamp: 1000 + i,
          episode: { id: `ep-${i}` } as EpisodeCreatedEvent['episode'],
        });
      }

      // Replay to a custom listener
      const replayedEvents: unknown[] = [];
      const count = emitter.replay({}, (event) => {
        replayedEvents.push(event);
      });

      expect(count).toBe(3);
      expect(replayedEvents).toHaveLength(3);
    });

    it('should get event stats', () => {
      emitter.emit<EpisodeCreatedEvent>({
        type: 'episode.created',
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      emitter.emit<WorkingMemoryCreatedEvent>({
        type: 'working_memory.created',
        item: {} as WorkingMemoryCreatedEvent['item'],
      });

      const stats = emitter.getEventStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.eventsByType['episode.created']).toBe(1);
      expect(stats.eventsByType['working_memory.created']).toBe(1);
    });

    it('should get audit log', () => {
      const now = Date.now();

      emitter.emit<EpisodeCreatedEvent>({
        type: 'episode.created',
        timestamp: now - 1000,
        sessionId: 'session-1',
        episode: {} as EpisodeCreatedEvent['episode'],
      });
      emitter.emit<EpisodeCreatedEvent>({
        type: 'episode.created',
        timestamp: now,
        sessionId: 'session-2',
        episode: {} as EpisodeCreatedEvent['episode'],
      });

      const auditLog = emitter.getAuditLog({
        type: 'episode.created',
        sessionId: 'session-1',
      });

      expect(auditLog).toHaveLength(1);
    });

    it('should clean up old events', () => {
      // Create emitter with short max age
      const shortLivedEmitter = new PersistentEventEmitter(connection, {
        persist: true,
        maxAgeDays: 0, // 0 days means all events are old
        cleanupOnStart: false,
      });

      // Emit an old event
      shortLivedEmitter.emit<EpisodeCreatedEvent>({
        type: 'episode.created',
        timestamp: Date.now() - 86400000, // 1 day ago
        episode: {} as EpisodeCreatedEvent['episode'],
      });

      expect(shortLivedEmitter.getEventCount()).toBe(1);

      // Clean up
      const deleted = shortLivedEmitter.cleanupOldEvents();
      expect(deleted).toBe(1);
      expect(shortLivedEmitter.getEventCount()).toBe(0);
    });
  });
});
