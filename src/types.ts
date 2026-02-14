// cc-memory v2 types

export type Scope = "shared" | "personal";
export type Role = "manager" | "worker";

export interface Memory {
  id: string;
  project_id: string;
  scope: Scope;
  agent_id: string | null;
  content: string;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  description: string | null;
  created_at: string;
}

export interface Agent {
  project_id: string;
  agent_id: string;
  role: Role;
  created_at: string;
}

// Tool input types
export interface MemoryStoreInput {
  scope: Scope;
  agent_id: string;
  content: string;
  tags?: string[];
  project_id?: string;
}

export interface MemoryRecallInput {
  scope: Scope | "all";
  agent_id?: string;
  query: string;
  project_id?: string;
  limit?: number;
}

export interface MemoryListInput {
  scope: Scope;
  agent_id?: string;
  project_id?: string;
}

export interface MemoryDeleteInput {
  memory_id: string;
}

export interface ProjectCreateInput {
  project_id: string;
  description: string;
}

export interface AgentRegisterInput {
  project_id: string;
  agent_id: string;
  role: Role;
}

export interface AgentListInput {
  project_id: string;
}
