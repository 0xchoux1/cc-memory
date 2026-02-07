/**
 * DIKWRepository - Handles DIKW pyramid storage operations
 * (Data -> Information -> Knowledge -> Wisdom)
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type {
  Pattern,
  PatternInput,
  PatternQuery,
  PatternStatus,
  Insight,
  InsightInput,
  InsightQuery,
  InsightStatus,
  WisdomEntity,
  WisdomEntityInput,
  WisdomQuery,
  AgentRole,
  KnowledgeLevel,
} from '../../memory/types.js';

export class DIKWRepository extends BaseRepository {
  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize DIKW tables
   */
  createTables(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    // Patterns table
    db.run(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        frequency INTEGER DEFAULT 1,
        supporting_episodes TEXT,
        related_tags TEXT,
        status TEXT DEFAULT 'candidate',
        source_agent_id TEXT,
        agent_roles TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status)`);

    // Insights table
    db.run(`
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        insight TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        novelty REAL DEFAULT 0.5,
        utility REAL DEFAULT 0.5,
        source_patterns TEXT,
        domains TEXT,
        source_agent_id TEXT,
        validated_by TEXT,
        status TEXT DEFAULT 'candidate',
        knowledge_level TEXT DEFAULT 'derived',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_insights_confidence ON insights(confidence)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status)`);

    // Wisdom table
    db.run(`
      CREATE TABLE IF NOT EXISTS wisdom (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        principle TEXT NOT NULL,
        description TEXT NOT NULL,
        derived_from_insights TEXT,
        derived_from_patterns TEXT,
        evidence_episodes TEXT,
        applicable_domains TEXT,
        applicable_contexts TEXT,
        limitations TEXT,
        validation_count INTEGER DEFAULT 0,
        successful_applications INTEGER DEFAULT 0,
        failed_applications INTEGER DEFAULT 0,
        confidence_score REAL DEFAULT 0.5,
        created_by TEXT,
        contributing_agents TEXT,
        version INTEGER DEFAULT 1,
        tags TEXT,
        related_wisdom TEXT,
        contradictory_wisdom TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_wisdom_name ON wisdom(name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_wisdom_confidence ON wisdom(confidence_score)`);
  }

  // ============================================================================
  // Pattern Operations
  // ============================================================================

  /**
   * Create a new pattern
   */
  createPattern(input: PatternInput, agentId?: string, agentRoles?: AgentRole[]): Pattern {
    const now = Date.now();
    const id = `pattern_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const pattern: Pattern = {
      id,
      pattern: input.pattern,
      confidence: input.confidence ?? 0.5,
      frequency: 1,
      supportingEpisodes: input.supportingEpisodes || [],
      relatedTags: input.relatedTags || [],
      status: 'candidate',
      sourceAgentId: agentId,
      agentRoles: agentRoles || [],
      createdAt: now,
      updatedAt: now,
    };

    this.run(`
      INSERT INTO patterns
      (id, pattern, confidence, frequency, supporting_episodes, related_tags, status, source_agent_id, agent_roles, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pattern.id,
      pattern.pattern,
      pattern.confidence,
      pattern.frequency,
      JSON.stringify(pattern.supportingEpisodes),
      JSON.stringify(pattern.relatedTags),
      pattern.status,
      pattern.sourceAgentId || null,
      JSON.stringify(pattern.agentRoles),
      pattern.createdAt,
      pattern.updatedAt,
    ]);

    return pattern;
  }

  /**
   * Get a pattern by ID
   */
  getPattern(id: string): Pattern | null {
    const result = this.exec('SELECT * FROM patterns WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToPattern(result[0].columns, result[0].values[0]);
  }

  /**
   * List patterns with optional filters
   */
  listPatterns(query?: PatternQuery): Pattern[] {
    let sql = 'SELECT * FROM patterns WHERE 1=1';
    const params: (string | number)[] = [];

    if (query?.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(query.minConfidence);
    }

    if (query?.minFrequency !== undefined) {
      sql += ' AND frequency >= ?';
      params.push(query.minFrequency);
    }

    if (query?.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query?.query) {
      sql += ' AND pattern LIKE ?';
      params.push(`%${query.query}%`);
    }

    sql += ' ORDER BY confidence DESC, frequency DESC';

    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToPattern(result[0].columns, row));
  }

  /**
   * Update pattern status
   */
  updatePatternStatus(id: string, status: PatternStatus): boolean {
    const now = Date.now();
    this.run(
      'UPDATE patterns SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, id]
    );
    return this.getRowsModified() > 0;
  }

  /**
   * Increment pattern frequency
   */
  incrementPatternFrequency(id: string): boolean {
    const now = Date.now();
    this.run(
      'UPDATE patterns SET frequency = frequency + 1, updated_at = ? WHERE id = ?',
      [now, id]
    );
    return this.getRowsModified() > 0;
  }

  // ============================================================================
  // Insight Operations
  // ============================================================================

  /**
   * Create a new insight
   */
  createInsight(input: InsightInput, agentId?: string): Insight {
    const now = Date.now();
    const id = `insight_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const insight: Insight = {
      id,
      insight: input.insight,
      reasoning: input.reasoning || '',
      confidence: input.confidence ?? 0.5,
      novelty: 0.5,
      utility: 0.5,
      sourcePatterns: input.sourcePatterns || [],
      domains: input.domains || [],
      sourceAgentId: agentId,
      validatedBy: [],
      status: 'candidate',
      knowledgeLevel: 'derived' as KnowledgeLevel,
      createdAt: now,
      updatedAt: now,
    };

    this.run(`
      INSERT INTO insights
      (id, insight, reasoning, confidence, novelty, utility, source_patterns, domains, source_agent_id, validated_by, status, knowledge_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      insight.id,
      insight.insight,
      insight.reasoning,
      insight.confidence,
      insight.novelty,
      insight.utility,
      JSON.stringify(insight.sourcePatterns),
      JSON.stringify(insight.domains),
      insight.sourceAgentId || null,
      JSON.stringify(insight.validatedBy),
      insight.status,
      insight.knowledgeLevel,
      insight.createdAt,
      insight.updatedAt,
    ]);

    return insight;
  }

  /**
   * Get an insight by ID
   */
  getInsight(id: string): Insight | null {
    const result = this.exec('SELECT * FROM insights WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToInsight(result[0].columns, result[0].values[0]);
  }

  /**
   * List insights with optional filters
   */
  listInsights(query?: InsightQuery): Insight[] {
    let sql = 'SELECT * FROM insights WHERE 1=1';
    const params: (string | number)[] = [];

    if (query?.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(query.minConfidence);
    }

    if (query?.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query?.query) {
      sql += ' AND insight LIKE ?';
      params.push(`%${query.query}%`);
    }

    sql += ' ORDER BY confidence DESC, created_at DESC';

    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToInsight(result[0].columns, row));
  }

  /**
   * Update insight status
   */
  updateInsightStatus(id: string, status: InsightStatus, validatorId?: string): boolean {
    const now = Date.now();
    const insight = this.getInsight(id);
    if (!insight) return false;

    const validatedBy = validatorId && !insight.validatedBy.includes(validatorId)
      ? [...insight.validatedBy, validatorId]
      : insight.validatedBy;

    this.run(
      'UPDATE insights SET status = ?, validated_by = ?, updated_at = ? WHERE id = ?',
      [status, JSON.stringify(validatedBy), now, id]
    );
    return this.getRowsModified() > 0;
  }

  // ============================================================================
  // Wisdom Operations
  // ============================================================================

  /**
   * Create a new wisdom entry
   */
  createWisdom(input: WisdomEntityInput, createdBy?: string): WisdomEntity {
    const now = Date.now();
    const id = `wisdom_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const wisdom: WisdomEntity = {
      id,
      name: input.name,
      principle: input.principle,
      description: input.description,
      derivedFromInsights: input.derivedFromInsights || [],
      derivedFromPatterns: input.derivedFromPatterns || [],
      evidenceEpisodes: input.evidenceEpisodes || [],
      applicableDomains: input.applicableDomains || [],
      applicableContexts: input.applicableContexts || [],
      limitations: input.limitations || [],
      validationCount: 0,
      successfulApplications: 0,
      failedApplications: 0,
      confidenceScore: 0.5,
      createdBy,
      contributingAgents: createdBy ? [createdBy] : [],
      version: 1,
      tags: input.tags || [],
      relatedWisdom: [],
      contradictoryWisdom: [],
      createdAt: now,
      updatedAt: now,
    };

    this.run(`
      INSERT INTO wisdom
      (id, name, principle, description, derived_from_insights, derived_from_patterns, evidence_episodes,
       applicable_domains, applicable_contexts, limitations, validation_count,
       successful_applications, failed_applications, confidence_score, created_by, contributing_agents,
       version, tags, related_wisdom, contradictory_wisdom, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      wisdom.id,
      wisdom.name,
      wisdom.principle,
      wisdom.description,
      JSON.stringify(wisdom.derivedFromInsights),
      JSON.stringify(wisdom.derivedFromPatterns),
      JSON.stringify(wisdom.evidenceEpisodes),
      JSON.stringify(wisdom.applicableDomains),
      JSON.stringify(wisdom.applicableContexts),
      JSON.stringify(wisdom.limitations),
      wisdom.validationCount,
      wisdom.successfulApplications,
      wisdom.failedApplications,
      wisdom.confidenceScore,
      wisdom.createdBy || null,
      JSON.stringify(wisdom.contributingAgents),
      wisdom.version,
      JSON.stringify(wisdom.tags),
      JSON.stringify(wisdom.relatedWisdom),
      JSON.stringify(wisdom.contradictoryWisdom),
      wisdom.createdAt,
      wisdom.updatedAt,
    ]);

    return wisdom;
  }

  /**
   * Get wisdom by ID or name
   */
  getWisdom(idOrName: string): WisdomEntity | null {
    const result = this.exec(
      'SELECT * FROM wisdom WHERE id = ? OR name = ?',
      [idOrName, idOrName]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToWisdom(result[0].columns, result[0].values[0]);
  }

  /**
   * List wisdom with optional filters
   */
  listWisdom(query?: WisdomQuery): WisdomEntity[] {
    let sql = 'SELECT * FROM wisdom WHERE 1=1';
    const params: (string | number)[] = [];

    if (query?.minConfidence !== undefined) {
      sql += ' AND confidence_score >= ?';
      params.push(query.minConfidence);
    }

    if (query?.query) {
      sql += ' AND (name LIKE ? OR principle LIKE ? OR description LIKE ?)';
      const pattern = `%${query.query}%`;
      params.push(pattern, pattern, pattern);
    }

    if (query?.domains && query.domains.length > 0) {
      // Check if any domain matches
      const domainConditions = query.domains.map(() =>
        `EXISTS (SELECT 1 FROM json_each(applicable_domains) WHERE json_each.value = ?)`
      ).join(' OR ');
      sql += ` AND (${domainConditions})`;
      params.push(...query.domains);
    }

    sql += ' ORDER BY confidence_score DESC, created_at DESC';

    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToWisdom(result[0].columns, row));
  }

  /**
   * Record a wisdom application
   */
  recordApplication(id: string, success: boolean): boolean {
    const now = Date.now();
    const wisdom = this.getWisdom(id);
    if (!wisdom) return false;

    const validationCount = wisdom.validationCount + 1;
    const successfulApplications = wisdom.successfulApplications + (success ? 1 : 0);
    const failedApplications = wisdom.failedApplications + (success ? 0 : 1);
    const newConfidence = Math.min(0.95, wisdom.confidenceScore + (success ? 0.05 : -0.02));

    this.run(`
      UPDATE wisdom SET
        validation_count = ?,
        successful_applications = ?,
        failed_applications = ?,
        confidence_score = ?,
        updated_at = ?
      WHERE id = ?
    `, [validationCount, successfulApplications, failedApplications, newConfidence, now, id]);

    return this.getRowsModified() > 0;
  }

  // ============================================================================
  // Row Conversion Helpers
  // ============================================================================

  private rowToPattern(columns: string[], row: unknown[]): Pattern {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      pattern: obj.pattern as string,
      confidence: obj.confidence as number,
      frequency: obj.frequency as number,
      supportingEpisodes: this.safeJsonParse(obj.supporting_episodes as string, []),
      relatedTags: this.safeJsonParse(obj.related_tags as string, []),
      status: obj.status as PatternStatus,
      sourceAgentId: obj.source_agent_id as string | undefined,
      agentRoles: this.safeJsonParse(obj.agent_roles as string, []),
      createdAt: obj.created_at as number,
      updatedAt: obj.updated_at as number,
    };
  }

  private rowToInsight(columns: string[], row: unknown[]): Insight {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      insight: obj.insight as string,
      reasoning: obj.reasoning as string,
      confidence: obj.confidence as number,
      novelty: obj.novelty as number,
      utility: obj.utility as number,
      sourcePatterns: this.safeJsonParse(obj.source_patterns as string, []),
      domains: this.safeJsonParse(obj.domains as string, []),
      sourceAgentId: obj.source_agent_id as string | undefined,
      validatedBy: this.safeJsonParse(obj.validated_by as string, []),
      status: obj.status as InsightStatus,
      knowledgeLevel: (obj.knowledge_level as KnowledgeLevel) || 'derived',
      createdAt: obj.created_at as number,
      updatedAt: obj.updated_at as number,
    };
  }

  private rowToWisdom(columns: string[], row: unknown[]): WisdomEntity {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      name: obj.name as string,
      principle: obj.principle as string,
      description: obj.description as string,
      derivedFromInsights: this.safeJsonParse(obj.derived_from_insights as string, []),
      derivedFromPatterns: this.safeJsonParse(obj.derived_from_patterns as string, []),
      evidenceEpisodes: this.safeJsonParse(obj.evidence_episodes as string, []),
      applicableDomains: this.safeJsonParse(obj.applicable_domains as string, []),
      applicableContexts: this.safeJsonParse(obj.applicable_contexts as string, []),
      limitations: this.safeJsonParse(obj.limitations as string, []),
      validationCount: obj.validation_count as number,
      successfulApplications: obj.successful_applications as number,
      failedApplications: obj.failed_applications as number,
      confidenceScore: obj.confidence_score as number,
      createdBy: obj.created_by as string | undefined,
      contributingAgents: this.safeJsonParse(obj.contributing_agents as string, []),
      version: obj.version as number,
      tags: this.safeJsonParse(obj.tags as string, []),
      relatedWisdom: this.safeJsonParse(obj.related_wisdom as string, []),
      contradictoryWisdom: this.safeJsonParse(obj.contradictory_wisdom as string, []),
      createdAt: obj.created_at as number,
      updatedAt: obj.updated_at as number,
    };
  }
}
