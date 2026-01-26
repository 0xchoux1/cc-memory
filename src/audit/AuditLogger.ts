/**
 * Audit Logger for tracking all cross-agent memory access and permission changes
 */

import { randomBytes } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Types of auditable actions
 */
export type AuditAction =
  | 'read'
  | 'write'
  | 'delete'
  | 'sync'
  | 'permission_change'
  | 'team_join'
  | 'team_leave'
  | 'shared_memory_access'
  | 'cross_agent_access'
  | 'conflict_resolution';

/**
 * Result of an audited action
 */
export type AuditResult = 'success' | 'denied' | 'error';

/**
 * Audit log entry
 */
export interface AuditEntry {
  id: string;
  timestamp: number;
  actor: string;
  actorPermissionLevel?: string;
  action: AuditAction;
  resource: string;
  resourceType: string;
  target?: string;
  result: AuditResult;
  reason?: string;
  metadata?: Record<string, unknown>;
  team?: string;
  sessionId?: string;
  ipAddress?: string;
}

/**
 * Audit entry input (without auto-generated fields)
 */
export type AuditEntryInput = Omit<AuditEntry, 'id' | 'timestamp'>;

/**
 * Filters for querying audit logs
 */
export interface AuditFilters {
  actor?: string;
  action?: AuditAction;
  resource?: string;
  resourceType?: string;
  target?: string;
  result?: AuditResult;
  team?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * Audit statistics
 */
export interface AuditStats {
  totalEntries: number;
  entriesByAction: Record<AuditAction, number>;
  entriesByResult: Record<AuditResult, number>;
  recentDenials: number;
  topActors: Array<{ actor: string; count: number }>;
  topResources: Array<{ resource: string; count: number }>;
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Interface for audit log storage backend
 */
export interface AuditStorage {
  insert(entry: AuditEntry): Promise<void>;
  query(filters: AuditFilters): Promise<AuditEntry[]>;
  getStats(since?: number): Promise<AuditStats>;
  prune(olderThan: number): Promise<number>;
  count(filters?: AuditFilters): Promise<number>;
}

// ============================================================================
// In-Memory Audit Storage
// ============================================================================

/**
 * In-memory audit storage implementation
 * Suitable for development and testing
 */
export class InMemoryAuditStorage implements AuditStorage {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  async insert(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);

    // Trim old entries if we exceed max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  async query(filters: AuditFilters): Promise<AuditEntry[]> {
    let results = this.entries;

    if (filters.actor) {
      results = results.filter(e => e.actor === filters.actor);
    }
    if (filters.action) {
      results = results.filter(e => e.action === filters.action);
    }
    if (filters.resource) {
      results = results.filter(e => e.resource === filters.resource);
    }
    if (filters.resourceType) {
      results = results.filter(e => e.resourceType === filters.resourceType);
    }
    if (filters.target) {
      results = results.filter(e => e.target === filters.target);
    }
    if (filters.result) {
      results = results.filter(e => e.result === filters.result);
    }
    if (filters.team) {
      results = results.filter(e => e.team === filters.team);
    }
    if (filters.startTime) {
      results = results.filter(e => e.timestamp >= filters.startTime!);
    }
    if (filters.endTime) {
      results = results.filter(e => e.timestamp <= filters.endTime!);
    }

    // Sort by timestamp descending (newest first)
    results = results.sort((a, b) => b.timestamp - a.timestamp);

    // Apply offset and limit
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  async getStats(since?: number): Promise<AuditStats> {
    const relevantEntries = since
      ? this.entries.filter(e => e.timestamp >= since)
      : this.entries;

    const entriesByAction: Record<string, number> = {};
    const entriesByResult: Record<string, number> = {};
    const actorCounts: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};

    for (const entry of relevantEntries) {
      entriesByAction[entry.action] = (entriesByAction[entry.action] ?? 0) + 1;
      entriesByResult[entry.result] = (entriesByResult[entry.result] ?? 0) + 1;
      actorCounts[entry.actor] = (actorCounts[entry.actor] ?? 0) + 1;
      resourceCounts[entry.resource] = (resourceCounts[entry.resource] ?? 0) + 1;
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentDenials = relevantEntries.filter(
      e => e.result === 'denied' && e.timestamp >= oneHourAgo
    ).length;

    const topActors = Object.entries(actorCounts)
      .map(([actor, count]) => ({ actor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topResources = Object.entries(resourceCounts)
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEntries: relevantEntries.length,
      entriesByAction: entriesByAction as Record<AuditAction, number>,
      entriesByResult: entriesByResult as Record<AuditResult, number>,
      recentDenials,
      topActors,
      topResources,
    };
  }

  async prune(olderThan: number): Promise<number> {
    const originalLength = this.entries.length;
    this.entries = this.entries.filter(e => e.timestamp >= olderThan);
    return originalLength - this.entries.length;
  }

  async count(filters?: AuditFilters): Promise<number> {
    if (!filters) {
      return this.entries.length;
    }
    const results = await this.query({ ...filters, limit: undefined, offset: undefined });
    return results.length;
  }

  /**
   * Get all entries (for testing)
   */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries = [];
  }
}

// ============================================================================
// SQLite Audit Storage
// ============================================================================

/**
 * SQLite-based audit storage implementation
 * Uses the existing SqliteStorage database connection
 */
export class SqliteAuditStorage implements AuditStorage {
  private db: {
    run: (sql: string, params?: unknown[]) => void;
    exec: (sql: string, params?: unknown[]) => Array<{ columns: string[]; values: unknown[][] }>;
  };

  constructor(db: {
    run: (sql: string, params?: unknown[]) => void;
    exec: (sql: string, params?: unknown[]) => Array<{ columns: string[]; values: unknown[][] }>;
  }) {
    this.db = db;
    this.createTable();
  }

  private createTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        actor_permission_level TEXT,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        target TEXT,
        result TEXT NOT NULL,
        reason TEXT,
        metadata TEXT,
        team TEXT,
        session_id TEXT,
        ip_address TEXT
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_log(result)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_team ON audit_log(team)`);
  }

  async insert(entry: AuditEntry): Promise<void> {
    this.db.run(`
      INSERT INTO audit_log (
        id, timestamp, actor, actor_permission_level, action, resource, resource_type,
        target, result, reason, metadata, team, session_id, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entry.id,
      entry.timestamp,
      entry.actor,
      entry.actorPermissionLevel ?? null,
      entry.action,
      entry.resource,
      entry.resourceType,
      entry.target ?? null,
      entry.result,
      entry.reason ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.team ?? null,
      entry.sessionId ?? null,
      entry.ipAddress ?? null,
    ]);
  }

  async query(filters: AuditFilters): Promise<AuditEntry[]> {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (filters.actor) {
      sql += ' AND actor = ?';
      params.push(filters.actor);
    }
    if (filters.action) {
      sql += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters.resource) {
      sql += ' AND resource = ?';
      params.push(filters.resource);
    }
    if (filters.resourceType) {
      sql += ' AND resource_type = ?';
      params.push(filters.resourceType);
    }
    if (filters.target) {
      sql += ' AND target = ?';
      params.push(filters.target);
    }
    if (filters.result) {
      sql += ' AND result = ?';
      params.push(filters.result);
    }
    if (filters.team) {
      sql += ' AND team = ?';
      params.push(filters.team);
    }
    if (filters.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(filters.endTime);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      sql += ` LIMIT ${filters.limit}`;
    }
    if (filters.offset) {
      sql += ` OFFSET ${filters.offset}`;
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    const { columns, values } = result[0];
    return values.map(row => this.rowToEntry(columns, row));
  }

  async getStats(since?: number): Promise<AuditStats> {
    const whereClause = since ? `WHERE timestamp >= ${since}` : '';

    // Total entries
    const totalResult = this.db.exec(`SELECT COUNT(*) FROM audit_log ${whereClause}`);
    const totalEntries = totalResult[0]?.values[0]?.[0] as number ?? 0;

    // Entries by action
    const actionResult = this.db.exec(
      `SELECT action, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY action`
    );
    const entriesByAction: Record<string, number> = {};
    if (actionResult[0]) {
      for (const row of actionResult[0].values) {
        entriesByAction[row[0] as string] = row[1] as number;
      }
    }

    // Entries by result
    const resultResult = this.db.exec(
      `SELECT result, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY result`
    );
    const entriesByResult: Record<string, number> = {};
    if (resultResult[0]) {
      for (const row of resultResult[0].values) {
        entriesByResult[row[0] as string] = row[1] as number;
      }
    }

    // Recent denials
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const denialResult = this.db.exec(
      `SELECT COUNT(*) FROM audit_log WHERE result = 'denied' AND timestamp >= ?`,
      [oneHourAgo]
    );
    const recentDenials = denialResult[0]?.values[0]?.[0] as number ?? 0;

    // Top actors
    const actorResult = this.db.exec(
      `SELECT actor, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY actor ORDER BY count DESC LIMIT 10`
    );
    const topActors: Array<{ actor: string; count: number }> = [];
    if (actorResult[0]) {
      for (const row of actorResult[0].values) {
        topActors.push({ actor: row[0] as string, count: row[1] as number });
      }
    }

    // Top resources
    const resourceResult = this.db.exec(
      `SELECT resource, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY resource ORDER BY count DESC LIMIT 10`
    );
    const topResources: Array<{ resource: string; count: number }> = [];
    if (resourceResult[0]) {
      for (const row of resourceResult[0].values) {
        topResources.push({ resource: row[0] as string, count: row[1] as number });
      }
    }

    return {
      totalEntries,
      entriesByAction: entriesByAction as Record<AuditAction, number>,
      entriesByResult: entriesByResult as Record<AuditResult, number>,
      recentDenials,
      topActors,
      topResources,
    };
  }

  async prune(olderThan: number): Promise<number> {
    const countResult = this.db.exec(
      'SELECT COUNT(*) FROM audit_log WHERE timestamp < ?',
      [olderThan]
    );
    const count = countResult[0]?.values[0]?.[0] as number ?? 0;

    this.db.run('DELETE FROM audit_log WHERE timestamp < ?', [olderThan]);
    return count;
  }

  async count(filters?: AuditFilters): Promise<number> {
    if (!filters) {
      const result = this.db.exec('SELECT COUNT(*) FROM audit_log');
      return result[0]?.values[0]?.[0] as number ?? 0;
    }

    let sql = 'SELECT COUNT(*) FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (filters.actor) {
      sql += ' AND actor = ?';
      params.push(filters.actor);
    }
    if (filters.action) {
      sql += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters.result) {
      sql += ' AND result = ?';
      params.push(filters.result);
    }
    if (filters.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(filters.endTime);
    }

    const result = this.db.exec(sql, params);
    return result[0]?.values[0]?.[0] as number ?? 0;
  }

  private rowToEntry(columns: string[], row: unknown[]): AuditEntry {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj['id'] as string,
      timestamp: obj['timestamp'] as number,
      actor: obj['actor'] as string,
      actorPermissionLevel: obj['actor_permission_level'] as string | undefined,
      action: obj['action'] as AuditAction,
      resource: obj['resource'] as string,
      resourceType: obj['resource_type'] as string,
      target: obj['target'] as string | undefined,
      result: obj['result'] as AuditResult,
      reason: obj['reason'] as string | undefined,
      metadata: obj['metadata'] ? JSON.parse(obj['metadata'] as string) : undefined,
      team: obj['team'] as string | undefined,
      sessionId: obj['session_id'] as string | undefined,
      ipAddress: obj['ip_address'] as string | undefined,
    };
  }
}

// ============================================================================
// AuditLogger Class
// ============================================================================

/**
 * Audit Logger for recording and querying audit entries
 */
export class AuditLogger {
  private storage: AuditStorage;
  private autoCleanupInterval?: NodeJS.Timeout;
  private retentionDays: number;

  constructor(storage: AuditStorage, options?: { retentionDays?: number; autoCleanup?: boolean }) {
    this.storage = storage;
    this.retentionDays = options?.retentionDays ?? 90;

    if (options?.autoCleanup !== false) {
      // Run cleanup daily
      this.autoCleanupInterval = setInterval(() => {
        this.cleanup().catch(console.error);
      }, 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Generate a unique audit entry ID
   */
  private generateId(): string {
    return `audit_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  /**
   * Log an audit entry
   */
  async log(input: AuditEntryInput): Promise<AuditEntry> {
    const entry: AuditEntry = {
      ...input,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    await this.storage.insert(entry);
    return entry;
  }

  /**
   * Query audit logs
   */
  async query(filters: AuditFilters): Promise<AuditEntry[]> {
    return this.storage.query(filters);
  }

  /**
   * Get activity for a specific agent
   */
  async getAgentActivity(agentId: string, since?: number): Promise<AuditEntry[]> {
    return this.storage.query({
      actor: agentId,
      startTime: since,
      limit: 1000,
    });
  }

  /**
   * Get activity targeting a specific agent
   */
  async getActivityTargetingAgent(targetAgentId: string, since?: number): Promise<AuditEntry[]> {
    return this.storage.query({
      target: targetAgentId,
      startTime: since,
      limit: 1000,
    });
  }

  /**
   * Get recent denied actions
   */
  async getRecentDenials(limit: number = 100): Promise<AuditEntry[]> {
    return this.storage.query({
      result: 'denied',
      limit,
    });
  }

  /**
   * Get audit statistics
   */
  async getStats(since?: number): Promise<AuditStats> {
    return this.storage.getStats(since);
  }

  /**
   * Cleanup old entries based on retention policy
   */
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    return this.storage.prune(cutoff);
  }

  /**
   * Get entry count
   */
  async count(filters?: AuditFilters): Promise<number> {
    return this.storage.count(filters);
  }

  /**
   * Stop auto-cleanup
   */
  close(): void {
    if (this.autoCleanupInterval) {
      clearInterval(this.autoCleanupInterval);
      this.autoCleanupInterval = undefined;
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a standard audit entry for memory read access
 */
export function createReadAuditEntry(
  actor: string,
  resource: string,
  resourceType: string,
  result: AuditResult,
  options?: Partial<AuditEntryInput>
): AuditEntryInput {
  return {
    actor,
    action: 'read',
    resource,
    resourceType,
    result,
    ...options,
  };
}

/**
 * Create a standard audit entry for memory write access
 */
export function createWriteAuditEntry(
  actor: string,
  resource: string,
  resourceType: string,
  result: AuditResult,
  options?: Partial<AuditEntryInput>
): AuditEntryInput {
  return {
    actor,
    action: 'write',
    resource,
    resourceType,
    result,
    ...options,
  };
}

/**
 * Create a standard audit entry for cross-agent access
 */
export function createCrossAgentAuditEntry(
  actor: string,
  target: string,
  action: 'read' | 'write',
  resource: string,
  resourceType: string,
  result: AuditResult,
  options?: Partial<AuditEntryInput>
): AuditEntryInput {
  return {
    actor,
    action: 'cross_agent_access',
    resource,
    resourceType,
    target,
    result,
    metadata: {
      crossAgentAction: action,
      ...options?.metadata,
    },
    ...options,
  };
}

/**
 * Create a standard audit entry for permission changes
 */
export function createPermissionChangeAuditEntry(
  actor: string,
  target: string,
  changeType: 'grant' | 'revoke' | 'modify',
  scopes: string[],
  result: AuditResult,
  options?: Partial<AuditEntryInput>
): AuditEntryInput {
  return {
    actor,
    action: 'permission_change',
    resource: `permission:${target}`,
    resourceType: 'permission',
    target,
    result,
    metadata: {
      changeType,
      scopes,
      ...options?.metadata,
    },
    ...options,
  };
}

/**
 * Create a standard audit entry for sync operations
 */
export function createSyncAuditEntry(
  actor: string,
  syncType: 'push' | 'pull' | 'merge',
  itemCount: number,
  result: AuditResult,
  options?: Partial<AuditEntryInput>
): AuditEntryInput {
  return {
    actor,
    action: 'sync',
    resource: `sync:${syncType}`,
    resourceType: 'sync',
    result,
    metadata: {
      syncType,
      itemCount,
      ...options?.metadata,
    },
    ...options,
  };
}
