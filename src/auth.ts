// cc-memory v2 auth - role-based access control
import type { Storage } from "./storage.js";
import type { Scope, Role } from "./types.js";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function checkStorePermission(
  storage: Storage,
  projectId: string,
  agentId: string,
  scope: Scope
): void {
  const agent = storage.getAgent(projectId, agentId);
  if (!agent) {
    throw new AuthError(`Agent "${agentId}" is not registered in project "${projectId}"`);
  }

  if (scope === "shared" && agent.role !== "manager") {
    throw new AuthError("Only managers can write to shared scope");
  }
}

export function checkReadPermission(
  storage: Storage,
  projectId: string,
  requestingAgentId: string,
  scope: Scope,
  targetAgentId?: string
): void {
  const agent = storage.getAgent(projectId, requestingAgentId);
  if (!agent) {
    throw new AuthError(`Agent "${requestingAgentId}" is not registered in project "${projectId}"`);
  }

  // shared: everyone can read
  if (scope === "shared") return;

  // personal: own data or manager
  if (scope === "personal") {
    if (targetAgentId && targetAgentId !== requestingAgentId && agent.role !== "manager") {
      throw new AuthError("Workers can only read their own personal memories");
    }
  }
}

export function getAgentRole(
  storage: Storage,
  projectId: string,
  agentId: string
): Role | null {
  const agent = storage.getAgent(projectId, agentId);
  return agent?.role ?? null;
}
