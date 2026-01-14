#!/usr/bin/env node
/**
 * CC-Memory MCP Server
 * Hierarchical memory system for Claude Code
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';

import { MemoryManager } from './memory/MemoryManager.js';
import {
  createToolHandlers,
  WorkingSetSchema,
  WorkingGetSchema,
  WorkingDeleteSchema,
  WorkingListSchema,
  WorkingClearSchema,
  EpisodeRecordSchema,
  EpisodeGetSchema,
  EpisodeSearchSchema,
  EpisodeUpdateSchema,
  EpisodeRelateSchema,
  SemanticCreateSchema,
  SemanticGetSchema,
  SemanticSearchSchema,
  SemanticAddObservationSchema,
  SemanticRelateSchema,
  SemanticUpdateSchema,
  MemoryConsolidateSchema,
  MemoryRecallSchema,
  MemoryImportSchema,
  MemoryExportSchema,
  SmartRecallSchema,
  MemoryDecaySchema,
  MemoryBoostSchema,
} from './server/tools.js';

// Configuration from environment
const DATA_PATH = process.env.MEMORY_DATA_PATH || join(homedir(), '.claude-memory');
const CLEANUP_INTERVAL = parseInt(process.env.MEMORY_CLEANUP_INTERVAL || '300000', 10); // 5 minutes

// Initialize memory manager
const memoryManager = new MemoryManager({
  dataPath: DATA_PATH,
  cleanupInterval: CLEANUP_INTERVAL,
});

// Create tool handlers
const handlers = createToolHandlers(memoryManager);

// Create MCP server
const server = new McpServer({
  name: 'cc-memory',
  version: '1.0.0',
});

// Register tools
server.tool(
  'working_set',
  'Store a value in working memory with optional TTL',
  WorkingSetSchema.shape,
  async (args) => {
    const result = handlers.working_set(args as z.infer<typeof WorkingSetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'working_get',
  'Retrieve a value from working memory',
  WorkingGetSchema.shape,
  async (args) => {
    const result = handlers.working_get(args as z.infer<typeof WorkingGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'working_delete',
  'Remove a value from working memory',
  WorkingDeleteSchema.shape,
  async (args) => {
    const result = handlers.working_delete(args as z.infer<typeof WorkingDeleteSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'working_list',
  'List all working memory items',
  WorkingListSchema.shape,
  async (args) => {
    const result = handlers.working_list(args as z.infer<typeof WorkingListSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'working_clear',
  'Clear expired or all working memory items',
  WorkingClearSchema.shape,
  async (args) => {
    const result = handlers.working_clear(args as z.infer<typeof WorkingClearSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'episode_record',
  'Record a new episode in episodic memory',
  EpisodeRecordSchema.shape,
  async (args) => {
    const result = handlers.episode_record(args as z.infer<typeof EpisodeRecordSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'episode_get',
  'Retrieve an episode by ID',
  EpisodeGetSchema.shape,
  async (args) => {
    const result = handlers.episode_get(args as z.infer<typeof EpisodeGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'episode_search',
  'Search episodes with full-text and filters',
  EpisodeSearchSchema.shape,
  async (args) => {
    const result = handlers.episode_search(args as z.infer<typeof EpisodeSearchSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'episode_update',
  'Update episode outcome, learnings, or importance',
  EpisodeUpdateSchema.shape,
  async (args) => {
    const result = handlers.episode_update(args as z.infer<typeof EpisodeUpdateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'episode_relate',
  'Create a relation between two episodes',
  EpisodeRelateSchema.shape,
  async (args) => {
    const result = handlers.episode_relate(args as z.infer<typeof EpisodeRelateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'semantic_create',
  'Create a new semantic entity (fact, procedure, pattern, etc.)',
  SemanticCreateSchema.shape,
  async (args) => {
    const result = handlers.semantic_create(args as z.infer<typeof SemanticCreateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'semantic_get',
  'Get a semantic entity by ID or name',
  SemanticGetSchema.shape,
  async (args) => {
    const result = handlers.semantic_get(args as z.infer<typeof SemanticGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'semantic_search',
  'Search semantic entities with full-text and filters',
  SemanticSearchSchema.shape,
  async (args) => {
    const result = handlers.semantic_search(args as z.infer<typeof SemanticSearchSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'semantic_add_observation',
  'Add an observation to a semantic entity',
  SemanticAddObservationSchema.shape,
  async (args) => {
    const result = handlers.semantic_add_observation(args as z.infer<typeof SemanticAddObservationSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'semantic_relate',
  'Create a relation between two semantic entities',
  SemanticRelateSchema.shape,
  async (args) => {
    const result = handlers.semantic_relate(args as z.infer<typeof SemanticRelateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'semantic_update',
  'Update a semantic entity',
  SemanticUpdateSchema.shape,
  async (args) => {
    const result = handlers.semantic_update(args as z.infer<typeof SemanticUpdateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_consolidate',
  'Promote working memory to episodic or semantic memory',
  MemoryConsolidateSchema.shape,
  async (args) => {
    const result = handlers.memory_consolidate(args as z.infer<typeof MemoryConsolidateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_recall',
  'Intelligent recall across all memory layers',
  MemoryRecallSchema.shape,
  async (args) => {
    const result = handlers.memory_recall(args as z.infer<typeof MemoryRecallSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_stats',
  'Get memory usage statistics',
  {},
  async () => {
    const result = handlers.memory_stats();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_import',
  'Import memory data from an export',
  MemoryImportSchema.shape,
  async (args) => {
    const result = handlers.memory_import(args as z.infer<typeof MemoryImportSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_export',
  'Export all memory data',
  MemoryExportSchema.shape,
  async (args) => {
    const result = handlers.memory_export(args as z.infer<typeof MemoryExportSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'smart_recall',
  'Intelligent recall with relevance scoring across all memory layers',
  SmartRecallSchema.shape,
  async (args) => {
    const result = handlers.smart_recall(args as z.infer<typeof SmartRecallSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_decay',
  'Apply importance decay to old episodic memories',
  MemoryDecaySchema.shape,
  async (args) => {
    const result = handlers.memory_decay(args as z.infer<typeof MemoryDecaySchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_boost',
  'Boost importance of frequently accessed memories',
  MemoryBoostSchema.shape,
  async (args) => {
    const result = handlers.memory_boost(args as z.infer<typeof MemoryBoostSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Register resources
server.resource(
  'memory://working',
  'memory://working',
  async () => {
    const items = memoryManager.working.list();
    return {
      contents: [{
        uri: 'memory://working',
        mimeType: 'application/json',
        text: JSON.stringify(items, null, 2),
      }],
    };
  }
);

server.resource(
  'memory://episodes/recent',
  'memory://episodes/recent',
  async () => {
    const episodes = memoryManager.episodic.getRecent(10);
    return {
      contents: [{
        uri: 'memory://episodes/recent',
        mimeType: 'application/json',
        text: JSON.stringify(episodes, null, 2),
      }],
    };
  }
);

server.resource(
  'memory://semantic/graph',
  'memory://semantic/graph',
  async () => {
    const graph = memoryManager.semantic.getGraph();
    return {
      contents: [{
        uri: 'memory://semantic/graph',
        mimeType: 'application/json',
        text: JSON.stringify(graph, null, 2),
      }],
    };
  }
);

server.resource(
  'memory://stats',
  'memory://stats',
  async () => {
    const stats = memoryManager.getStats();
    return {
      contents: [{
        uri: 'memory://stats',
        mimeType: 'application/json',
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
);

// Register prompts
server.prompt(
  'recall_context',
  'Retrieve relevant memories for current task',
  {
    task_description: z.string().describe('Description of current task'),
    include_episodes: z.boolean().optional().default(true),
    include_semantic: z.boolean().optional().default(true),
  },
  async (args) => {
    const context = await memoryManager.getFormattedContext(args.task_description as string);
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Based on the task: "${args.task_description}", here is the relevant context from memory:\n\n${context}`,
        },
      }],
    };
  }
);

server.prompt(
  'summarize_session',
  'Generate summary of current session for episodic storage',
  {
    session_id: z.string().optional(),
  },
  async (args) => {
    const sessionId = args.session_id as string | undefined || memoryManager.getSessionId();
    const workingItems = memoryManager.working.getBySession(sessionId);
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Please summarize the key events from session ${sessionId} for long-term storage. Working memory contents:\n${JSON.stringify(workingItems, null, 2)}`,
        },
      }],
    };
  }
);

server.prompt(
  'extract_learnings',
  'Extract semantic knowledge from episodic memories',
  {
    episode_ids: z.array(z.string()).optional(),
    recent_count: z.number().optional().default(5),
  },
  async (args) => {
    let episodes;
    if (args.episode_ids && (args.episode_ids as string[]).length > 0) {
      episodes = memoryManager.episodic.getByIds(args.episode_ids as string[]);
    } else {
      episodes = memoryManager.episodic.getRecent(args.recent_count as number);
    }
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Analyze these episodes and extract generalizable knowledge, patterns, or procedures that should be stored in semantic memory:\n${JSON.stringify(episodes, null, 2)}`,
        },
      }],
    };
  }
);

// Graceful shutdown
process.on('SIGINT', () => {
  memoryManager.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  memoryManager.close();
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CC-Memory MCP server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
