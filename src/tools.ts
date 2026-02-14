// cc-memory v2 tools - MCP tool definitions and handlers
import { z } from "zod";
import type { Storage } from "./storage.js";
import { checkStorePermission, checkReadPermission, AuthError } from "./auth.js";

const DEFAULT_PROJECT = "default";

// Tool schemas
export const schemas = {
  memory_store: z.object({
    scope: z.enum(["shared", "personal"]),
    agent_id: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    project_id: z.string().optional(),
  }),
  memory_recall: z.object({
    scope: z.enum(["shared", "personal", "all"]),
    agent_id: z.string().optional(),
    query: z.string(),
    project_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  memory_list: z.object({
    scope: z.enum(["shared", "personal"]),
    agent_id: z.string().optional(),
    project_id: z.string().optional(),
  }),
  memory_delete: z.object({
    memory_id: z.string(),
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
      "Store a memory. Shared scope requires manager role. Personal scope stores for the given agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal"], description: "Memory scope" },
        agent_id: { type: "string", description: "Agent ID (caller)" },
        content: { type: "string", description: "Memory content" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        project_id: { type: "string", description: "Project ID (default: 'default')" },
      },
      required: ["scope", "agent_id", "content"],
    },
  },
  {
    name: "memory_recall",
    description: "Search memories by query. Returns matching memories ranked by relevance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string", enum: ["shared", "personal", "all"], description: "Search scope" },
        agent_id: { type: "string", description: "Filter by agent ID" },
        query: { type: "string", description: "Search query" },
        project_id: { type: "string", description: "Project ID" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["scope", "query"],
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
    name: "memory_delete",
    description: "Delete a memory by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "string", description: "Memory ID to delete" },
      },
      required: ["memory_id"],
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
          const memory = storage.storeMemory(projectId, input.scope, agentId, input.content, input.tags ?? null);
          return JSON.stringify({ ok: true, memory });
        }

        case "memory_recall": {
          const input = schemas.memory_recall.parse(args);
          const projectId = input.project_id;
          const memories = storage.searchMemories(
            input.query,
            input.scope,
            projectId,
            input.agent_id,
            input.limit ?? 10
          );
          return JSON.stringify({ ok: true, count: memories.length, memories });
        }

        case "memory_list": {
          const input = schemas.memory_list.parse(args);
          const memories = storage.listMemories(input.scope, input.project_id, input.agent_id);
          return JSON.stringify({ ok: true, count: memories.length, memories });
        }

        case "memory_delete": {
          const input = schemas.memory_delete.parse(args);
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
          // Verify project exists
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
