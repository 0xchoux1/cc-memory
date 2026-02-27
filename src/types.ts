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
  created_by: string | null;
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
