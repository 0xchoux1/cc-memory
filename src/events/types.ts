/**
 * Memory event types for event sourcing
 */

import type {
  WorkingMemoryItem,
  EpisodicMemory,
  SemanticEntity,
  Pattern,
  Insight,
  WisdomEntity,
} from '../memory/types.js';

// Base event interface
export interface MemoryEvent {
  type: string;
  timestamp: number;
  sessionId?: string;
}

// Working Memory Events
export interface WorkingMemoryCreatedEvent extends MemoryEvent {
  type: 'working_memory.created';
  item: WorkingMemoryItem;
}

export interface WorkingMemoryUpdatedEvent extends MemoryEvent {
  type: 'working_memory.updated';
  key: string;
  changes: Partial<WorkingMemoryItem>;
}

export interface WorkingMemoryDeletedEvent extends MemoryEvent {
  type: 'working_memory.deleted';
  key: string;
}

export interface WorkingMemoryEvictedEvent extends MemoryEvent {
  type: 'working_memory.evicted';
  item: WorkingMemoryItem;
  reason: 'capacity' | 'expired';
}

export interface WorkingMemoryConsolidatedEvent extends MemoryEvent {
  type: 'working_memory.consolidated';
  key: string;
  targetType: 'episodic' | 'semantic';
  targetId: string;
}

// Episodic Memory Events
export interface EpisodeCreatedEvent extends MemoryEvent {
  type: 'episode.created';
  episode: EpisodicMemory;
}

export interface EpisodeUpdatedEvent extends MemoryEvent {
  type: 'episode.updated';
  id: string;
  changes: Partial<EpisodicMemory>;
}

export interface EpisodeAccessedEvent extends MemoryEvent {
  type: 'episode.accessed';
  id: string;
  accessCount: number;
}

export interface EpisodeDecayedEvent extends MemoryEvent {
  type: 'episode.decayed';
  id: string;
  previousImportance: number;
  newImportance: number;
}

// Semantic Memory Events
export interface EntityCreatedEvent extends MemoryEvent {
  type: 'entity.created';
  entity: SemanticEntity;
}

export interface EntityUpdatedEvent extends MemoryEvent {
  type: 'entity.updated';
  id: string;
  changes: Partial<SemanticEntity>;
}

export interface EntityRelatedEvent extends MemoryEvent {
  type: 'entity.related';
  fromId: string;
  toId: string;
  relationType: string;
}

// DIKW Events
export interface PatternCreatedEvent extends MemoryEvent {
  type: 'pattern.created';
  pattern: Pattern;
}

export interface PatternConfirmedEvent extends MemoryEvent {
  type: 'pattern.confirmed';
  id: string;
  confirmed: boolean;
}

export interface InsightCreatedEvent extends MemoryEvent {
  type: 'insight.created';
  insight: Insight;
}

export interface InsightValidatedEvent extends MemoryEvent {
  type: 'insight.validated';
  id: string;
  validated: boolean;
}

export interface WisdomCreatedEvent extends MemoryEvent {
  type: 'wisdom.created';
  wisdom: WisdomEntity;
}

export interface WisdomAppliedEvent extends MemoryEvent {
  type: 'wisdom.applied';
  wisdomId: string;
  context: string;
  result: 'success' | 'failure' | 'partial';
}

// Session Events
export interface SessionStartedEvent extends MemoryEvent {
  type: 'session.started';
  sessionId: string;
}

export interface SessionEndedEvent extends MemoryEvent {
  type: 'session.ended';
  sessionId: string;
  consolidatedCount: number;
}

// Union of all events
export type AllMemoryEvents =
  | WorkingMemoryCreatedEvent
  | WorkingMemoryUpdatedEvent
  | WorkingMemoryDeletedEvent
  | WorkingMemoryEvictedEvent
  | WorkingMemoryConsolidatedEvent
  | EpisodeCreatedEvent
  | EpisodeUpdatedEvent
  | EpisodeAccessedEvent
  | EpisodeDecayedEvent
  | EntityCreatedEvent
  | EntityUpdatedEvent
  | EntityRelatedEvent
  | PatternCreatedEvent
  | PatternConfirmedEvent
  | InsightCreatedEvent
  | InsightValidatedEvent
  | WisdomCreatedEvent
  | WisdomAppliedEvent
  | SessionStartedEvent
  | SessionEndedEvent;

// Event type names
export type MemoryEventType = AllMemoryEvents['type'];

// Event listener type
export type MemoryEventListener<T extends MemoryEvent = AllMemoryEvents> = (event: T) => void;
