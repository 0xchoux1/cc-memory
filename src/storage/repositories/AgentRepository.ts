/**
 * AgentRepository - Handles agent profile storage operations
 */

import { BaseRepository } from './BaseRepository.js';
import type { DatabaseConnection } from '../DatabaseConnection.js';
import type { AgentProfile, AgentProfileInput, AgentRole } from '../../memory/types.js';
import { v7 as uuidv7 } from 'uuid';

export class AgentRepository extends BaseRepository {
  constructor(connection: DatabaseConnection) {
    super(connection);
  }

  /**
   * Initialize agent tables
   */
  createTables(): void {
    const db = this.connection.getDatabase();
    if (!db) return;

    db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        specializations TEXT,
        capabilities TEXT,
        knowledge_domains TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(last_active_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)`);
  }

  /**
   * Create a new agent profile
   */
  create(input: AgentProfileInput): AgentProfile {
    const now = Date.now();
    const id = `agent_${uuidv7()}`;

    const profile: AgentProfile = {
      id,
      name: input.name,
      role: input.role,
      specializations: input.specializations || [],
      capabilities: input.capabilities || [],
      knowledgeDomains: input.knowledgeDomains || [],
      createdAt: now,
      lastActiveAt: now,
    };

    this.run(`
      INSERT INTO agents
      (id, name, role, specializations, capabilities, knowledge_domains, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      profile.id,
      profile.name,
      profile.role,
      JSON.stringify(profile.specializations),
      JSON.stringify(profile.capabilities),
      JSON.stringify(profile.knowledgeDomains),
      profile.createdAt,
      profile.lastActiveAt,
    ]);

    return profile;
  }

  /**
   * Get an agent by ID
   */
  get(id: string): AgentProfile | null {
    const result = this.exec('SELECT * FROM agents WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToAgent(result[0].columns, result[0].values[0]);
  }

  /**
   * Get an agent by name
   */
  getByName(name: string): AgentProfile | null {
    const result = this.exec('SELECT * FROM agents WHERE name = ?', [name]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToAgent(result[0].columns, result[0].values[0]);
  }

  /**
   * List agents with optional filters
   */
  list(filter?: { role?: AgentRole; activeWithinMs?: number }): AgentProfile[] {
    let sql = 'SELECT * FROM agents WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.role) {
      sql += ' AND role = ?';
      params.push(filter.role);
    }

    if (filter?.activeWithinMs) {
      const cutoff = Date.now() - filter.activeWithinMs;
      sql += ' AND last_active_at >= ?';
      params.push(cutoff);
    }

    sql += ' ORDER BY last_active_at DESC';

    const result = this.exec(sql, params);
    if (result.length === 0) return [];

    return result[0].values.map(row => this.rowToAgent(result[0].columns, row));
  }

  /**
   * Update agent's last active time
   */
  updateActivity(id: string): AgentProfile | null {
    const now = Date.now();
    this.run('UPDATE agents SET last_active_at = ? WHERE id = ?', [now, id]);
    return this.get(id);
  }

  /**
   * Delete an agent
   */
  delete(id: string): boolean {
    this.run('DELETE FROM agents WHERE id = ?', [id]);
    return this.getRowsModified() > 0;
  }

  /**
   * Convert a database row to an AgentProfile object
   */
  private rowToAgent(columns: string[], row: unknown[]): AgentProfile {
    const obj = this.rowToObject(columns, row);
    return {
      id: obj.id as string,
      name: obj.name as string,
      role: obj.role as AgentRole,
      specializations: this.safeJsonParse(obj.specializations as string, []),
      capabilities: this.safeJsonParse(obj.capabilities as string, []),
      knowledgeDomains: this.safeJsonParse(obj.knowledge_domains as string, []),
      createdAt: obj.created_at as number,
      lastActiveAt: obj.last_active_at as number,
    };
  }
}
