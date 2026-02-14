// cc-memory v2 storage - SQLite via better-sqlite3
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Memory, Project, Agent, Scope, Role } from "./types.js";

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

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string = "cc-memory.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    // Add created_by column if missing (migration)
    this.migrateCreatedBy();
    // Ensure default project exists
    this.ensureDefaultProject();
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

  searchMemories(
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

    // Score and rank in memory
    return searchAndRank(rows, query, limit);
  }

  getMemory(id: string): Memory | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as RawMemory | undefined;
    return row ? parseMemoryRow(row) : undefined;
  }

  deleteMemory(id: string): boolean {
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

function searchAndRank(memories: Memory[], query: string, limit: number): Memory[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return memories.slice(0, limit);

  const scored = memories.map((m) => {
    const text = (m.content + " " + (m.tags?.join(" ") ?? "")).toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) score++;
    }
    return { memory: m, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.memory);
}
