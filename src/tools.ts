// cc-memory v3 tools - MCP tool definitions and handlers
import { z } from "zod";
import type { Storage } from "./storage.js";
import { checkStorePermission, checkReadPermission, getAgentRole, AuthError } from "./auth.js";
import { embed, DIMENSIONS } from "./embeddings.js";

const DEFAULT_PROJECT = "default";

// Tool schemas
export const schemas = {
  memory_store: z.object({
    scope: z.enum(["shared", "personal"]),
    agent_id: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    project_id: z.string().optional(),
    embedding: z.array(z.number()).length(DIMENSIONS).optional(),
  }),
  memory_recall: z.object({
    scope: z.enum(["shared", "personal", "all"]),
    agent_id: z.string().optional(),
    caller_id: z.string(),
    query: z.string(),
    project_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    embedding: z.array(z.number()).length(DIMENSIONS).optional(),
  }),
  memory_list: z.object({
    scope: z.enum(["shared", "personal"]),
    agent_id: z.string().optional(),
    project_id: z.string().optional(),
  }),
  memory_update: z.object({
    memory_id: z.string(),
    content: z.string(),
    caller_id: z.string(),
    project_id: z.string().optional(),
  }),
  memory_delete: z.object({
    memory_id: z.string(),
    caller_id: z.string(),
    project_id: z.string().optional(),
  }),
  project_create: z.object({
    project_id: z.string(),
    description: z.string(),
  }),
  project_list: z.object({}),
  agent_register: z.object({
    project_id: z.string(),
    agent_id: z.string(),
    role: z.enum(["manager", "worker"]),
  }),
  agent_list: z.object({
    project_id: z.string(),
  }),
};

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: "memory_store",
    description:
      "Store a memory. Shared scope requires manager role. Personal scope stores for the given agent. Optionally pass a pre-computed embedding (384-dim float array).",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal"], description: "Memory scope" },
        agent_id: { type: "string", description: "Agent ID (caller)" },
        content: { type: "string", description: "Memory content" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        project_id: { type: "string", description: "Project ID (default: 'default')" },
        embedding: { type: "array", items: { type: "number" }, description: "Pre-computed embedding (384-dim). If omitted, auto-generated when available." },
      },
      required: ["scope", "agent_id", "content"],
    },
  },
  {
    name: "memory_recall",
    description: "Search memories by query. Returns matching memories ranked by hybrid (keyword + semantic) relevance. Optionally pass a pre-computed query embedding.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal", "all"], description: "Search scope" },
        agent_id: { type: "string", description: "Filter by agent ID" },
        caller_id: { type: "string", description: "Caller agent ID for permission checks" },
        query: { type: "string", description: "Search query" },
        project_id: { type: "string", description: "Project ID" },
        limit: { type: "number", description: "Max results (default: 10)" },
        embedding: { type: "array", items: { type: "number" }, description: "Pre-computed query embedding (384-dim). If omitted, auto-generated when available." },
      },
      required: ["scope", "query", "caller_id"],
    },
  },
  {
    name: "memory_list",
    description: "List all memories in a scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal"], description: "Memory scope" },
        agent_id: { type: "string", description: "Filter by agent ID" },
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["scope"],
    },
  },
  {
    name: "memory_update",
    description: "Update the content of an existing memory. Only the owner or a manager can update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "string", description: "Memory ID to update" },
        content: { type: "string", description: "New content for the memory" },
        caller_id: { type: "string", description: "Caller agent ID for permission checks" },
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["memory_id", "content", "caller_id"],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a memory by ID. Only the owner or a manager can delete.",
    inputSchema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "string", description: "Memory ID to delete" },
        caller_id: { type: "string", description: "Caller agent ID for permission checks" },
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["memory_id", "caller_id"],
    },
  },
  {
    name: "project_create",
    description: "Create a new project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        description: { type: "string", description: "Project description" },
      },
      required: ["project_id", "description"],
    },
  },
  {
    name: "project_list",
    description: "List all projects.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "agent_register",
    description: "Register an agent to a project with a role.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        agent_id: { type: "string", description: "Agent ID" },
        role: { type: "string", enum: ["manager", "worker"], description: "Agent role" },
      },
      required: ["project_id", "agent_id", "role"],
    },
  },
  {
    name: "agent_list",
    description: "List all agents in a project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["project_id"],
    },
  },
];

// Resolve embedding: caller-provided > auto-generate > undefined
async function resolveEmbedding(
  callerEmbedding: number[] | undefined,
  text: string,
  vectorEnabled: boolean
): Promise<{ embedding: Float32Array | undefined; status: "stored" | "pending" | "skipped" }> {
  if (callerEmbedding) {
    return { embedding: new Float32Array(callerEmbedding), status: "stored" };
  }
  if (!vectorEnabled) {
    return { embedding: undefined, status: "skipped" };
  }
  // Auto-generate (may return null if transformers unavailable)
  const emb = await embed(text);
  if (emb) {
    return { embedding: emb, status: "stored" };
  }
  return { embedding: undefined, status: "skipped" };
}

// Handler
export function createToolHandler(storage: Storage) {
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    try {
      switch (name) {
        case "memory_store": {
          const input = schemas.memory_store.parse(args);
          const projectId = input.project_id ?? DEFAULT_PROJECT;
          checkStorePermission(storage, projectId, input.agent_id, input.scope);
          const agentId = input.scope === "personal" ? input.agent_id : null;
          const memory = storage.storeMemory(projectId, input.scope, agentId, input.content, input.tags ?? null, input.agent_id);

          // Embedding: sync for caller-provided, fire-and-forget for auto-generated
          let embeddingStatus: "stored" | "pending" | "skipped";
          if (input.embedding) {
            storage.storeEmbedding(memory.id, projectId, new Float32Array(input.embedding));
            embeddingStatus = "stored";
          } else if (storage.vectorEnabled) {
            embeddingStatus = "pending";
            const text = input.content + " " + (input.tags?.join(" ") ?? "");
            embed(text)
              .then((emb) => {
                if (emb) storage.storeEmbedding(memory.id, projectId, emb);
              })
              .catch((err) => console.error("Embedding store failed:", err));
          } else {
            embeddingStatus = "skipped";
          }

          return JSON.stringify({ ok: true, memory, embedding_status: embeddingStatus });
        }

        case "memory_recall": {
          const input = schemas.memory_recall.parse(args);
          const projectId = input.project_id ?? DEFAULT_PROJECT;
          const callerId = input.caller_id;

          // Resolve query embedding
          const { embedding: queryEmbedding } = await resolveEmbedding(
            input.embedding,
            input.query,
            storage.vectorEnabled
          );

          {
            if (input.scope === "personal") {
              checkReadPermission(storage, projectId, callerId, "personal", input.agent_id);
            } else if (input.scope === "all") {
              const role = getAgentRole(storage, projectId, callerId);
              if (role === "worker") {
                const shared = storage.searchMemories(input.query, "shared", projectId, undefined, input.limit ?? 10, queryEmbedding);
                const personal = storage.searchMemories(input.query, "personal", projectId, callerId, input.limit ?? 10, queryEmbedding);
                const merged = [...shared, ...personal]
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .slice(0, input.limit ?? 10);
                return JSON.stringify({ ok: true, count: merged.length, memories: merged });
              }
            }
          }

          const agentFilter = input.scope === "shared" ? undefined : input.agent_id;
          const memories = storage.searchMemories(
            input.query,
            input.scope,
            projectId,
            agentFilter,
            input.limit ?? 10,
            queryEmbedding
          );
          return JSON.stringify({ ok: true, count: memories.length, memories });
        }

        case "memory_list": {
          const input = schemas.memory_list.parse(args);
          const listAgentFilter = input.scope === "shared" ? undefined : input.agent_id;
          const memories = storage.listMemories(input.scope, input.project_id, listAgentFilter);
          return JSON.stringify({ ok: true, count: memories.length, memories });
        }

        case "memory_update": {
          const input = schemas.memory_update.parse(args);
          const projectId = input.project_id ?? DEFAULT_PROJECT;
          const memory = storage.getMemory(input.memory_id);
          if (!memory) {
            return JSON.stringify({ ok: false, error: "Memory not found" });
          }
          const role = getAgentRole(storage, projectId, input.caller_id);
          if (!role) {
            throw new AuthError(`Agent "${input.caller_id}" is not registered in project "${projectId}"`);
          }
          const isOwner = memory.agent_id === input.caller_id || memory.created_by === input.caller_id;
          if (!isOwner && role !== "manager") {
            throw new AuthError("Only the memory owner or a manager can update memories");
          }
          const updated = storage.updateMemory(input.memory_id, input.content, input.caller_id);

          // Re-generate embedding
          if (storage.vectorEnabled) {
            embed(input.content)
              .then((emb) => {
                if (emb) storage.storeEmbedding(input.memory_id, projectId, emb);
              })
              .catch((err) => console.error("Embedding update failed:", err));
          }

          return JSON.stringify({ ok: true, memory: updated });
        }

        case "memory_delete": {
          const input = schemas.memory_delete.parse(args);
          {
            const projectId = input.project_id ?? DEFAULT_PROJECT;
            const memory = storage.getMemory(input.memory_id);
            if (memory) {
              const role = getAgentRole(storage, projectId, input.caller_id);
              if (!role) {
                throw new AuthError(`Agent "${input.caller_id}" is not registered in project "${projectId}"`);
              }
              const isOwner = memory.agent_id === input.caller_id || memory.created_by === input.caller_id;
              if (!isOwner && role !== "manager") {
                throw new AuthError("Only the memory owner or a manager can delete memories");
              }
            }
          }

          const deleted = storage.deleteMemory(input.memory_id);
          return JSON.stringify({ ok: deleted, message: deleted ? "Deleted" : "Not found" });
        }

        case "project_create": {
          const input = schemas.project_create.parse(args);
          const project = storage.createProject(input.project_id, input.description);
          return JSON.stringify({ ok: true, project });
        }

        case "project_list": {
          const projects = storage.listProjects();
          return JSON.stringify({ ok: true, count: projects.length, projects });
        }

        case "agent_register": {
          const input = schemas.agent_register.parse(args);
          const project = storage.getProject(input.project_id);
          if (!project) {
            return JSON.stringify({ ok: false, error: `Project "${input.project_id}" not found` });
          }
          const agent = storage.registerAgent(input.project_id, input.agent_id, input.role);
          return JSON.stringify({ ok: true, agent });
        }

        case "agent_list": {
          const input = schemas.agent_list.parse(args);
          const agents = storage.listAgents(input.project_id);
          return JSON.stringify({ ok: true, count: agents.length, agents });
        }

        default:
          return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
      }
    } catch (err) {
      if (err instanceof AuthError) {
        return JSON.stringify({ ok: false, error: err.message });
      }
      if (err instanceof z.ZodError) {
        return JSON.stringify({ ok: false, error: "Invalid input", details: err.errors });
      }
      throw err;
    }
  };
}
