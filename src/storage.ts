// cc-memory v3 storage - SQLite via better-sqlite3 + optional sqlite-vec
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

  listAllMemories(): Memory[] {
    return (this.db.prepare("SELECT * FROM memories ORDER BY created_at").all() as RawMemory[]).map(parseMemoryRow);
  }

  searchMemories(
    query: string,
    scope: Scope | "all",
    projectId?: string,
    agentId?: string,
    limit: number = 10,
    queryEmbedding?: Float32Array
  ): Memory[] {
    // 1. Keyword search (existing logic)
    const keywordResults = this.keywordSearch(query, scope, projectId, agentId);

    // 2. Vector search (if available)
    const vectorDistances = new Map<string, number>();
    if (queryEmbedding && this.vectorEnabled && projectId) {
      const vecResults = this.vectorSearch(queryEmbedding, projectId, limit * 2);
      for (const r of vecResults) {
        vectorDistances.set(r.memory_id, r.distance);
      }

      // Fetch memories found only by vector search (not in keyword results)
      const keywordIds = new Set(keywordResults.map((m) => m.id));
      for (const r of vecResults) {
        if (!keywordIds.has(r.memory_id)) {
          const mem = this.getMemory(r.memory_id);
          if (mem && matchesScope(mem, scope, agentId)) {
            keywordResults.push(mem);
          }
        }
      }
    }

    // 3. Hybrid ranking
    return hybridFilterAndRank(keywordResults, query, vectorDistances, limit);
  }

  private keywordSearch(
    query: string,
    scope: Scope | "all",
    projectId?: string,
    agentId?: string
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

    const likeClauses = terms.map(() => "(content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
    sql += " AND (" + likeClauses.join(" OR ") + ")";
    for (const term of terms) {
      const escaped = term.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      params.push(pattern, pattern);
    }

    sql += " ORDER BY created_at DESC";
    return (this.db.prepare(sql).all(...params) as RawMemory[]).map(parseMemoryRow);
  }

  // Embedding CRUD
  storeEmbedding(memoryId: string, projectId: string, embedding: Float32Array): void {
    if (!this.vectorEnabled) return;
    this.db
      .prepare("INSERT OR REPLACE INTO vec_memories (memory_id, project_id, embedding) VALUES (?, ?, ?)")
      .run(memoryId, projectId, Buffer.from(embedding.buffer));
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
    return this.db
      .prepare(
        `SELECT memory_id, distance FROM vec_memories
         WHERE project_id = ? AND embedding MATCH ?
         ORDER BY distance LIMIT ?`
      )
      .all(projectId, Buffer.from(queryEmbedding.buffer), limit) as Array<{
      memory_id: string;
      distance: number;
    }>;
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

// Hybrid scoring
const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const DECAY_LAMBDA = 0.0000001;

function textScore(memory: Memory, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const text = (memory.content + " " + (memory.tags?.join(" ") ?? "")).toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (text.includes(term)) hits++;
  }
  return hits / terms.length; // normalized 0-1
}

function hybridFilterAndRank(
  memories: Memory[],
  query: string,
  vectorDistances: Map<string, number>,
  limit: number
): Memory[] {
  const now = Date.now();
  const hasVector = vectorDistances.size > 0;

  const scored = memories.map((m) => {
    const ts = textScore(m, query);
    const dist = vectorDistances.get(m.id);
    const vs = dist != null ? 1 - dist : null;

    let score: number;
    if (vs != null) {
      score = VECTOR_WEIGHT * vs + TEXT_WEIGHT * ts;
    } else if (hasVector) {
      // Vector search active but this memory wasn't in vector results — text only, penalized
      score = TEXT_WEIGHT * ts;
    } else {
      // No vector search — text score is all we have
      score = ts;
    }

    // Temporal decay
    const age = now - new Date(m.updated_at).getTime();
    const decay = Math.exp(-DECAY_LAMBDA * age);
    score *= decay;

    return { memory: m, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.memory);
}
