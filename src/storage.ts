// cc-memory v3 storage - SQLite via better-sqlite3 + sqlite-vec
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { Memory, Project, Agent, Scope, Role } from "./types.js";
import { DIMENSIONS } from "./embeddings.js";

const require = createRequire(import.meta.url);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager', 'worker')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, agent_id)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('shared', 'personal')),
  agent_id TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
`;

const VEC_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
  memory_id TEXT PRIMARY KEY,
  project_id TEXT PARTITION KEY,
  embedding float[${DIMENSIONS}] distance_metric=cosine
);
`;

// Hybrid scoring weights
const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const DECAY_LAMBDA = 1e-10; // ~0.86% per day (ageMs unit)

export class Storage {
  private db: Database.Database;
  vectorEnabled: boolean = false;

  constructor(dbPath: string = "cc-memory.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrateCreatedBy();
    this.ensureDefaultProject();
    this.initVectorSearch();
  }

  private initVectorSearch(): void {
    try {
      const sqliteVec = require("sqlite-vec");
      sqliteVec.load(this.db);
      this.db.exec(VEC_SCHEMA);
      this.vectorEnabled = true;
    } catch {
      this.vectorEnabled = false;
    }
  }

  private migrateCreatedBy(): void {
    const cols = this.db.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "created_by")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN created_by TEXT");
    }
  }

  private ensureDefaultProject(): void {
    const existing = this.db.prepare("SELECT id FROM projects WHERE id = ?").get("default");
    if (!existing) {
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO projects (id, description, created_at) VALUES (?, ?, ?)").run("default", "Default project", now);
    }
  }

  // Projects
  createProject(id: string, description: string): Project {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO projects (id, description, created_at) VALUES (?, ?, ?)")
      .run(id, description, now);
    return { id, description, created_at: now };
  }

  listProjects(): Project[] {
    return this.db.prepare("SELECT * FROM projects ORDER BY created_at").all() as Project[];
  }

  getProject(id: string): Project | undefined {
    return this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  }

  // Agents
  registerAgent(projectId: string, agentId: string, role: Role): Agent {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO agents (project_id, agent_id, role, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(projectId, agentId, role, now);
    return { project_id: projectId, agent_id: agentId, role, created_at: now };
  }

  listAgents(projectId: string): Agent[] {
    return this.db
      .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at")
      .all(projectId) as Agent[];
  }

  getAgent(projectId: string, agentId: string): Agent | undefined {
    return this.db
      .prepare("SELECT * FROM agents WHERE project_id = ? AND agent_id = ?")
      .get(projectId, agentId) as Agent | undefined;
  }

  // Embeddings
  storeEmbedding(memoryId: string, projectId: string, embedding: Float32Array): void {
    if (!this.vectorEnabled) return;
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db
      .prepare("INSERT OR REPLACE INTO vec_memories (memory_id, project_id, embedding) VALUES (?, ?, ?)")
      .run(memoryId, projectId, buf);
  }

  deleteEmbedding(memoryId: string): void {
    if (!this.vectorEnabled) return;
    this.db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(memoryId);
  }

  private vectorSearch(
    queryEmbedding: Float32Array,
    projectId: string,
    limit: number
  ): Array<{ memory_id: string; distance: number }> {
    if (!this.vectorEnabled) return [];
    const buf = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);
    return this.db
      .prepare(
        `SELECT memory_id, distance FROM vec_memories
         WHERE project_id = ? AND embedding MATCH ? ORDER BY distance LIMIT ?`
      )
      .all(projectId, buf, limit) as Array<{ memory_id: string; distance: number }>;
  }

  // Memories
  storeMemory(
    projectId: string,
    scope: Scope,
    agentId: string | null,
    content: string,
    tags: string[] | null,
    createdBy: string | null = null
  ): Memory {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tagsJson = tags ? JSON.stringify(tags) : null;
    this.db
      .prepare(
        "INSERT INTO memories (id, project_id, scope, agent_id, content, tags, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, projectId, scope, agentId, content, tagsJson, createdBy, now, now);
    return { id, project_id: projectId, scope, agent_id: agentId, content, tags, created_by: createdBy, created_at: now, updated_at: now };
  }

  listMemories(scope: Scope, projectId?: string, agentId?: string): Memory[] {
    let sql = "SELECT * FROM memories WHERE scope = ?";
    const params: unknown[] = [scope];

    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (agentId) {
      sql += " AND agent_id = ?";
      params.push(agentId);
    }

    sql += " ORDER BY created_at DESC";
    return (this.db.prepare(sql).all(...params) as RawMemory[]).map(parseMemoryRow);
  }

  listAllMemories(projectId?: string): Memory[] {
    let sql = "SELECT * FROM memories";
    const params: unknown[] = [];

    if (projectId) {
      sql += " WHERE project_id = ?";
      params.push(projectId);
    }

    sql += " ORDER BY created_at DESC";
    return (this.db.prepare(sql).all(...params) as RawMemory[]).map(parseMemoryRow);
  }

  searchMemories(
    query: string,
    scope: Scope | "all",
    projectId?: string,
    agentId?: string,
    limit: number = 10,
    queryEmbedding?: Float32Array
  ): Memory[] {
    // If we have a query embedding and vector search is available, use hybrid search
    if (queryEmbedding && this.vectorEnabled && projectId) {
      return this.hybridSearch(query, scope, projectId, agentId, limit, queryEmbedding);
    }

    // Keyword-only fallback
    return this.keywordSearch(query, scope, projectId, agentId, limit);
  }

  private keywordSearch(
    query: string,
    scope: Scope | "all",
    projectId?: string,
    agentId?: string,
    limit: number = 10
  ): Memory[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    let sql = "SELECT * FROM memories WHERE 1=1";
    const params: unknown[] = [];

    if (scope !== "all") {
      sql += " AND scope = ?";
      params.push(scope);
    }
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (agentId) {
      sql += " AND agent_id = ?";
      params.push(agentId);
    }

    // SQL LIKE filter: at least one term must match
    const likeClauses = terms.map(() => "(content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
    sql += " AND (" + likeClauses.join(" OR ") + ")";
    for (const term of terms) {
      const escaped = term.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      params.push(pattern, pattern);
    }

    sql += " ORDER BY created_at DESC";
    const rows = (this.db.prepare(sql).all(...params) as RawMemory[]).map(parseMemoryRow);

    return searchAndRank(rows, query, limit);
  }

  private hybridSearch(
    query: string,
    scope: Scope | "all",
    projectId: string,
    agentId: string | undefined,
    limit: number,
    queryEmbedding: Float32Array
  ): Memory[] {
    // Get vector results (fetch more than needed for filtering)
    const vecResults = this.vectorSearch(queryEmbedding, projectId, limit * 3);
    const vecMap = new Map(vecResults.map((r) => [r.memory_id, r.distance]));

    // Get keyword results
    const keywordResults = this.keywordSearch(query, scope, projectId, agentId, limit * 3);
    const keywordIds = new Set(keywordResults.map((m) => m.id));

    // Collect all candidate IDs
    const allIds = new Set([...vecMap.keys(), ...keywordIds]);

    // Load all candidate memories
    const candidateMap = new Map<string, Memory>();
    for (const m of keywordResults) {
      candidateMap.set(m.id, m);
    }
    // Load any vec-only results from DB
    for (const id of vecMap.keys()) {
      if (!candidateMap.has(id)) {
        const m = this.getMemory(id);
        if (m) candidateMap.set(id, m);
      }
    }

    // Filter by scope/agent
    const now = Date.now();
    const scored: Array<{ memory: Memory; score: number }> = [];

    for (const id of allIds) {
      const memory = candidateMap.get(id);
      if (!memory) continue;
      if (!matchesScope(memory, scope, agentId)) continue;

      // Vector score: cosine distance → similarity (1 - distance)
      const vecDistance = vecMap.get(id);
      const vecScore = vecDistance !== undefined ? (1 - vecDistance) : 0;

      // Text score
      const tScore = textScore(memory, query);

      // Temporal decay
      const ageMs = now - new Date(memory.updated_at).getTime();
      const decay = Math.exp(-DECAY_LAMBDA * ageMs);

      const finalScore = (VECTOR_WEIGHT * vecScore + TEXT_WEIGHT * tScore) * decay;
      scored.push({ memory, score: finalScore });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.memory);
  }

  getMemory(id: string): Memory | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as RawMemory | undefined;
    return row ? parseMemoryRow(row) : undefined;
  }

  updateMemory(id: string, content: string, updatedBy: string): Memory | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?")
      .run(content, now, id);
    if (result.changes === 0) return null;
    // Content changed — old embedding is now stale
    this.deleteEmbedding(id);
    return this.getMemory(id) ?? null;
  }

  deleteMemory(id: string): boolean {
    this.deleteEmbedding(id);
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

// Internal helpers
interface RawMemory {
  id: string;
  project_id: string;
  scope: string;
  agent_id: string | null;
  content: string;
  tags: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function parseMemoryRow(row: RawMemory): Memory {
  return {
    ...row,
    scope: row.scope as Scope,
    tags: row.tags ? JSON.parse(row.tags) : null,
  };
}

function matchesScope(memory: Memory, scope: Scope | "all", agentId?: string): boolean {
  if (scope !== "all" && memory.scope !== scope) return false;
  if (agentId && memory.agent_id !== agentId) return false;
  return true;
}

function textScore(memory: Memory, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const text = (memory.content + " " + (memory.tags?.join(" ") ?? "")).toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (text.includes(term)) matched++;
  }
  return matched / terms.length;
}

function searchAndRank(memories: Memory[], query: string, limit: number): Memory[] {
  return memories
    .map((m) => ({ memory: m, score: textScore(m, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.memory);
}
