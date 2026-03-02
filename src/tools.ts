// cc-memory v3 tools - MCP tool definitions and handlers
import { z } from "zod";
import type { Storage } from "./storage.js";
import { checkStorePermission, checkReadPermission, getAgentRole, AuthError } from "./auth.js";
import { embed, DIMENSIONS } from "./embeddings.js";
import { analyzeMemories, executeCuration } from "./curate.js";

const DEFAULT_PROJECT = "default";

// embedding: true = auto-generate, number[] = use directly
const embeddingSchema = z.union([z.literal(true), z.array(z.number()).length(DIMENSIONS)]).optional();

// Tool schemas
export const schemas = {
  memory_store: z.object({
    scope: z.enum(["shared", "personal"]),
    agent_id: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    project_id: z.string().optional(),
    embedding: embeddingSchema,
  }),
  memory_recall: z.object({
    scope: z.enum(["shared", "personal", "all"]),
    agent_id: z.string().optional(),
    caller_id: z.string(),
    query: z.string(),
    project_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    embedding: embeddingSchema,
  }),
  memory_list: z.object({
    scope: z.enum(["shared", "personal"]),
    agent_id: z.string().optional(),
    project_id: z.string().optional(),
  }),
  memory_update: z.object({
    memory_id: z.string(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    caller_id: z.string(),
    project_id: z.string().optional(),
    embedding: embeddingSchema,
  }).refine(
    (data) => data.content !== undefined || data.tags !== undefined,
    { message: "At least one of 'content' or 'tags' must be provided" }
  ),
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
  memory_curate: z.object({
    caller_id: z.string(),
    project_id: z.string().optional(),
    scope: z.enum(["shared", "personal"]).optional(),
    threshold: z.number().min(0).max(1).optional(),
    dry_run: z.boolean().optional(),
  }),
};

// Helper: resolve embedding for store/update
// embeddingInput: true = auto-generate, number[] = use directly, undefined = skip
async function resolveEmbedding(
  content: string,
  embeddingInput: true | number[] | undefined,
  vectorEnabled: boolean
): Promise<{ embedding: Float32Array | null; status: "stored" | "pending" | "skipped" }> {
  if (!embeddingInput || !vectorEnabled) {
    return { embedding: null, status: "skipped" };
  }
  // Direct embedding provided
  if (Array.isArray(embeddingInput)) {
    return { embedding: new Float32Array(embeddingInput), status: "stored" };
  }
  // Auto-generate
  try {
    const vec = await embed(content);
    if (vec) return { embedding: vec, status: "stored" };
    return { embedding: null, status: "pending" };
  } catch {
    return { embedding: null, status: "pending" };
  }
}

// Helper: resolve query embedding for recall
async function resolveQueryEmbedding(
  embeddingInput: true | number[] | undefined,
  query: string
): Promise<Float32Array | undefined> {
  if (!embeddingInput) return undefined;
  if (Array.isArray(embeddingInput)) return new Float32Array(embeddingInput);
  return (await embed(query)) ?? undefined;
}

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: "memory_store",
    description:
      "Store a memory. Shared scope requires manager role. Personal scope stores for the given agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal"], description: "Memory scope" },
        agent_id: { type: "string", description: "Agent ID (caller)" },
        content: { type: "string", description: "Memory content" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        project_id: { type: "string", description: "Project ID (default: 'default')" },
        embedding: { oneOf: [{ type: "boolean", const: true }, { type: "array", items: { type: "number" } }], description: "true = auto-generate embedding, number[384] = use provided vector" },
      },
      required: ["scope", "agent_id", "content"],
    },
  },
  {
    name: "memory_recall",
    description: "Search memories by query. Returns matching memories ranked by relevance. When embedding=true, uses hybrid vector+keyword search.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal", "all"], description: "Search scope" },
        agent_id: { type: "string", description: "Filter by agent ID" },
        caller_id: { type: "string", description: "Caller agent ID for permission checks" },
        query: { type: "string", description: "Search query" },
        project_id: { type: "string", description: "Project ID" },
        limit: { type: "number", description: "Max results (default: 10)" },
        embedding: { oneOf: [{ type: "boolean", const: true }, { type: "array", items: { type: "number" } }], description: "true = auto-generate query embedding, number[384] = use provided vector" },
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
    description: "Update the content and/or tags of an existing memory. At least one of content or tags must be provided. Only the owner or a manager can update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "string", description: "Memory ID to update" },
        content: { type: "string", description: "New content for the memory. Omit to keep current content." },
        tags: { type: "array", items: { type: "string" }, description: "New tags (replaces existing tags). Omit to keep current tags." },
        caller_id: { type: "string", description: "Caller agent ID for permission checks" },
        project_id: { type: "string", description: "Project ID" },
        embedding: { oneOf: [{ type: "boolean", const: true }, { type: "array", items: { type: "number" } }], description: "true = auto-generate embedding, number[384] = use provided vector" },
      },
      required: ["memory_id", "caller_id"],
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
  {
    name: "memory_curate",
    description: "Analyze and clean up duplicate/stale memories. Manager only for shared scope. Workers can curate their own personal memories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        caller_id: { type: "string", description: "Caller agent ID (for RBAC)" },
        project_id: { type: "string", description: "Project ID (default: 'default')" },
        scope: { type: "string", enum: ["shared", "personal"], description: "Scope to curate (default: all accessible)" },
        threshold: { type: "number", description: "Similarity threshold 0-1 (default: 0.85)" },
        dry_run: { type: "boolean", description: "If true, report only without deleting (default: true)" },
      },
      required: ["caller_id"],
    },
  },
];

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

          // Handle embedding
          const { embedding, status } = await resolveEmbedding(input.content, input.embedding, storage.vectorEnabled);
          if (embedding) {
            storage.storeEmbedding(memory.id, projectId, embedding);
          }

          return JSON.stringify({ ok: true, memory, embedding_status: status });
        }

        case "memory_recall": {
          const input = schemas.memory_recall.parse(args);
          const projectId = input.project_id ?? DEFAULT_PROJECT;
          const callerId = input.caller_id;

          // Resolve query embedding upfront (used by all paths)
          const queryEmbedding = await resolveQueryEmbedding(input.embedding, input.query);

          // Auth checks
          if (input.scope === "personal") {
            checkReadPermission(storage, projectId, callerId, "personal", input.agent_id);
          } else if (input.scope === "all") {
            const role = getAgentRole(storage, projectId, callerId);
            if (role === "worker") {
              // Worker scope=all: search shared + own personal separately, merge by score
              const limit = input.limit ?? 10;
              const shared = storage.searchMemories(input.query, "shared", projectId, undefined, limit, queryEmbedding);
              const personal = storage.searchMemories(input.query, "personal", projectId, callerId, limit, queryEmbedding);
              const seen = new Set<string>();
              const merged: typeof shared = [];
              for (const m of [...shared, ...personal]) {
                if (!seen.has(m.id)) {
                  seen.add(m.id);
                  merged.push(m);
                }
              }
              const result = merged.slice(0, limit);
              return JSON.stringify({ ok: true, count: result.length, memories: result });
            }
            // manager can see all - fall through
          }

          // For shared scope, ignore agent_id filter (shared memories have agent_id=NULL)
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
          // updateMemory deletes stale embedding automatically
          const updated = storage.updateMemory(input.memory_id, input.caller_id, input.content, input.tags);

          // Re-generate embedding if requested (use new or existing content)
          const embeddingContent = input.content ?? memory.content;
          const { embedding: newEmb, status: embeddingStatus } = await resolveEmbedding(
            embeddingContent, input.embedding, storage.vectorEnabled
          );
          if (newEmb) {
            storage.storeEmbedding(input.memory_id, projectId, newEmb);
          }

          return JSON.stringify({ ok: true, memory: updated, embedding_status: embeddingStatus });
        }

        case "memory_delete": {
          const input = schemas.memory_delete.parse(args);
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

        case "memory_curate": {
          const input = schemas.memory_curate.parse(args);
          const projectId = input.project_id ?? DEFAULT_PROJECT;
          const role = getAgentRole(storage, projectId, input.caller_id);
          if (!role) {
            throw new AuthError(`Agent "${input.caller_id}" is not registered in project "${projectId}"`);
          }

          if (!storage.vectorEnabled) {
            return JSON.stringify({ ok: false, error: "Vector search not available — sqlite-vec required for curation" });
          }

          // Determine which memories to curate based on role and scope
          let memories: import("./types.js").Memory[];
          if (input.scope === "shared") {
            if (role !== "manager") {
              throw new AuthError("Only managers can curate shared memories");
            }
            memories = storage.listMemories("shared", projectId);
          } else if (input.scope === "personal") {
            // Workers can only curate their own personal
            const agentId = role === "manager" ? undefined : input.caller_id;
            memories = storage.listMemories("personal", projectId, agentId);
          } else {
            // No scope specified: manager gets all, worker gets own personal only
            if (role === "manager") {
              memories = storage.listAllMemories(projectId);
            } else {
              memories = storage.listMemories("personal", projectId, input.caller_id);
            }
          }

          const report = analyzeMemories(storage, memories, input.threshold);
          const dryRun = input.dry_run !== false; // default true

          if (!dryRun) {
            const executed = executeCuration(storage, report);
            return JSON.stringify({
              ok: true,
              dry_run: false,
              duplicate_groups: executed.duplicates.length,
              deleted_count: executed.deleted_count,
              stale_count: executed.stale.length,
              report: executed,
            });
          }

          return JSON.stringify({
            ok: true,
            dry_run: true,
            duplicate_groups: report.duplicates.length,
            would_delete: report.duplicates.reduce((n, g) => n + g.duplicates.length, 0),
            stale_count: report.stale.length,
            report,
          });
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
