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
import { SyncManager, FileSyncAdapter, CloudSyncAdapter } from './sync/index.js';
import {
  createToolHandlers,
  WorkingSetSchema,
  WorkingGetSchema,
  WorkingDeleteSchema,
  WorkingListSchema,
  WorkingClearSchema,
  EpisodeRecordSchema,
  EpisodeGetSchema,
  EpisodeGetTranscriptSchema,
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
  ReconsolidationCandidatesSchema,
  MergeEpisodesSchema,
  MemoryDecaySchema,
  MemoryBoostSchema,
  // Tachikoma & Agent & Wisdom schemas
  TachikomaInitSchema,
  TachikomaStatusSchema,
  TachikomaExportSchema,
  TachikomaImportSchema,
  TachikomaConflictsSchema,
  TachikomaResolveConflictSchema,
  AgentRegisterSchema,
  AgentGetSchema,
  AgentListSchema,
  PatternCreateSchema,
  PatternGetSchema,
  PatternListSchema,
  PatternConfirmSchema,
  InsightCreateSchema,
  InsightGetSchema,
  InsightListSchema,
  InsightValidateSchema,
  WisdomCreateSchema,
  WisdomGetSchema,
  WisdomSearchSchema,
  WisdomApplySchema,
  // Unified high-level tools
  UnifiedMemoryStoreSchema,
  UnifiedMemoryUpdateSchema,
  UnifiedMemoryForgetSchema,
} from './server/tools.js';
import { SqliteStorage } from './storage/SqliteStorage.js';

// Configuration from environment
const DATA_PATH = process.env.MEMORY_DATA_PATH || join(homedir(), '.claude-memory');
const CLEANUP_INTERVAL = parseInt(process.env.MEMORY_CLEANUP_INTERVAL || '300000', 10); // 5 minutes
const TACHIKOMA_NAME = process.env.CC_MEMORY_TACHIKOMA_NAME;
const SYNC_DIR = process.env.CC_MEMORY_SYNC_DIR;
const SYNC_TYPE = process.env.CC_MEMORY_SYNC_TYPE || 'file'; // 'file' or 'cloud'
const CLOUD_SYNC_DIR = process.env.CC_MEMORY_CLOUD_SYNC_DIR;
const SYNC_INTERVAL = parseInt(process.env.CC_MEMORY_SYNC_INTERVAL || '0', 10); // Auto-sync interval in seconds (0 = disabled)

// Initialize memory manager
const memoryManager = new MemoryManager({
  dataPath: DATA_PATH,
  cleanupInterval: CLEANUP_INTERVAL,
});

// Create tool handlers
const storage = memoryManager.getStorage();
const handlers = createToolHandlers(memoryManager, storage);

// Auto-initialize Tachikoma if name is specified via environment variable
async function initializeTachikoma(): Promise<void> {
  if (TACHIKOMA_NAME) {
    await storage.ready();
    const profile = storage.initTachikoma(undefined, TACHIKOMA_NAME);
    console.error(`Tachikoma initialized: ${profile.name} (${profile.id})`);
  }
}

// Initialize SyncManager
let syncManager: SyncManager | undefined;

// Auto-sync from sync directory on startup using SyncManager
async function autoSyncFromDirectory(): Promise<void> {
  // Determine sync directory (CLOUD_SYNC_DIR takes priority for cloud type)
  const syncDir = SYNC_TYPE === 'cloud' ? (CLOUD_SYNC_DIR || SYNC_DIR) : SYNC_DIR;

  if (!syncDir) {
    return;
  }

  await storage.ready();

  // Create SyncManager
  syncManager = new SyncManager(storage, {
    conflictStrategy: 'merge_learnings',
    autoResolve: true,
    autoSyncInterval: SYNC_INTERVAL > 0 ? SYNC_INTERVAL * 1000 : 0,
  });

  // Get current Tachikoma ID
  const currentProfile = storage.getTachikomaProfile();

  // Create adapter based on sync type
  if (SYNC_TYPE === 'cloud') {
    // CloudSyncAdapter with file watching
    const cloudAdapter = new CloudSyncAdapter({
      name: 'cloud',
      syncDir: syncDir,
      watchInterval: 5000, // 5 seconds
    });

    if (currentProfile) {
      cloudAdapter.setTachikomaId(currentProfile.id);
    }

    await syncManager.addAdapter('cloud', cloudAdapter);
    console.error(`Cloud sync initialized with: ${syncDir}`);
  } else {
    // FileSyncAdapter (default)
    const fileSyncAdapter = new FileSyncAdapter({
      name: 'file',
      syncDir: syncDir,
    });

    if (currentProfile) {
      fileSyncAdapter.setTachikomaId(currentProfile.id);
    }

    await syncManager.addAdapter('file', fileSyncAdapter);
  }

  // Perform initial pull
  const results = await syncManager.pullFromAll();
  for (const [name, result] of results) {
    if (result.success && result.syncedItems > 0) {
      console.error(`[${name}] Synced ${result.syncedItems} items from: ${syncDir}`);
    } else if (!result.success) {
      console.error(`[${name}] Sync error: ${result.error}`);
    }
  }

  // Start auto-sync if configured
  if (SYNC_INTERVAL > 0) {
    syncManager.startAutoSync();
    console.error(`Auto-sync enabled: every ${SYNC_INTERVAL} seconds`);
  }
}

// Server instructions for Claude
const SERVER_INSTRUCTIONS = `
# cc-memory 使用ルール

cc-memory は Claude の持続的記憶システムです。以下のルールに従って使用してください。

## セッション開始時（重要）

新しいセッションでユーザーの最初のメッセージを受け取ったら、必ず以下を実行すること：

1. memory_recall でユーザーの発言に関連する記憶を検索
2. semantic_search(type: "preference") でユーザーの好みを確認
3. 検索結果を踏まえて応答する

## 記憶の保存タイミング

- ユーザーの好み・設定を学んだ → semantic_create (type: preference)
- 重要な事実を学んだ → semantic_create (type: fact)
- タスクが完了した → episode_record (type: success/milestone)
- エラーを解決した → episode_record (type: error)
- パターンを発見した → semantic_create (type: pattern)

## importance の目安

- 8-10: 絶対に覚えておくべき（ユーザーの重要な好み、重大なマイルストーン）
- 5-7: 一般的な記憶（通常のタスク完了、学んだ事実）
- 1-4: 軽微な記憶（小さな修正、一時的な情報）

## 注意事項

- ユーザーに「覚えて」と言われなくても、重要な情報は自主的に記憶すること
- 過去の記憶と矛盾する新情報があれば、semantic_update で更新すること
`.trim();

// Create MCP server
const server = new McpServer({
  name: 'cc-memory',
  version: '1.0.0',
}, {
  instructions: SERVER_INSTRUCTIONS,
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
  'episode_get_transcript',
  'Get the full conversation transcript for an episode',
  EpisodeGetTranscriptSchema.shape,
  async (args) => {
    const result = handlers.episode_get_transcript(args as z.infer<typeof EpisodeGetTranscriptSchema>);
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
  'Intelligent recall with relevance scoring, spreading activation, and context-dependent encoding bonus',
  SmartRecallSchema.shape,
  async (args) => {
    const result = handlers.smart_recall(args as z.infer<typeof SmartRecallSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'reconsolidation_candidates',
  'Find episodes that could be merged with a given episode (reconsolidation)',
  ReconsolidationCandidatesSchema.shape,
  async (args) => {
    const result = handlers.reconsolidation_candidates(args as z.infer<typeof ReconsolidationCandidatesSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'merge_episodes',
  'Merge two episodes into one (reconsolidation)',
  MergeEpisodesSchema.shape,
  async (args) => {
    const result = handlers.merge_episodes(args as z.infer<typeof MergeEpisodesSchema>);
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

// Tachikoma Parallelization Tools
server.tool(
  'tachikoma_init',
  'Initialize Tachikoma parallelization (set individual ID and name)',
  TachikomaInitSchema.shape,
  async (args) => {
    const result = handlers.tachikoma_init(args as z.infer<typeof TachikomaInitSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'tachikoma_status',
  'Get Tachikoma sync status and optionally sync history',
  TachikomaStatusSchema.shape,
  async (args) => {
    const result = handlers.tachikoma_status(args as z.infer<typeof TachikomaStatusSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'tachikoma_export',
  'Export memories as delta for parallelization with other Tachikoma instances',
  TachikomaExportSchema.shape,
  async (args) => {
    const result = handlers.tachikoma_export(args as z.infer<typeof TachikomaExportSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'tachikoma_import',
  'Import and merge memories from another Tachikoma instance',
  TachikomaImportSchema.shape,
  async (args) => {
    const result = handlers.tachikoma_import(args as z.infer<typeof TachikomaImportSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'tachikoma_conflicts',
  'List pending conflicts from memory merges',
  TachikomaConflictsSchema.shape,
  async (args) => {
    const result = handlers.tachikoma_conflicts(args as z.infer<typeof TachikomaConflictsSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'tachikoma_resolve_conflict',
  'Resolve a merge conflict manually',
  TachikomaResolveConflictSchema.shape,
  async (args) => {
    const result = handlers.tachikoma_resolve_conflict(args as z.infer<typeof TachikomaResolveConflictSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Agent Management Tools
server.tool(
  'agent_register',
  'Register a new agent with role and specializations',
  AgentRegisterSchema.shape,
  async (args) => {
    const result = handlers.agent_register(args as z.infer<typeof AgentRegisterSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'agent_get',
  'Get agent profile by ID',
  AgentGetSchema.shape,
  async (args) => {
    const result = handlers.agent_get(args as z.infer<typeof AgentGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'agent_list',
  'List agents with optional role and activity filters',
  AgentListSchema.shape,
  async (args) => {
    const result = handlers.agent_list(args as z.infer<typeof AgentListSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Pattern Tools
server.tool(
  'pattern_create',
  'Create a new pattern from episodic observations',
  PatternCreateSchema.shape,
  async (args) => {
    const result = handlers.pattern_create(args as z.infer<typeof PatternCreateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'pattern_get',
  'Get a pattern by ID',
  PatternGetSchema.shape,
  async (args) => {
    const result = handlers.pattern_get(args as z.infer<typeof PatternGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'pattern_list',
  'List patterns with optional filters',
  PatternListSchema.shape,
  async (args) => {
    const result = handlers.pattern_list(args as z.infer<typeof PatternListSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'pattern_confirm',
  'Confirm or reject a pattern',
  PatternConfirmSchema.shape,
  async (args) => {
    const result = handlers.pattern_confirm(args as z.infer<typeof PatternConfirmSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Insight Tools
server.tool(
  'insight_create',
  'Create an insight from patterns',
  InsightCreateSchema.shape,
  async (args) => {
    const result = handlers.insight_create(args as z.infer<typeof InsightCreateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'insight_get',
  'Get an insight by ID',
  InsightGetSchema.shape,
  async (args) => {
    const result = handlers.insight_get(args as z.infer<typeof InsightGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'insight_list',
  'List insights with optional filters',
  InsightListSchema.shape,
  async (args) => {
    const result = handlers.insight_list(args as z.infer<typeof InsightListSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'insight_validate',
  'Validate or reject an insight',
  InsightValidateSchema.shape,
  async (args) => {
    const result = handlers.insight_validate(args as z.infer<typeof InsightValidateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Wisdom Tools
server.tool(
  'wisdom_create',
  'Create wisdom from insights and patterns (DIKW Level 4)',
  WisdomCreateSchema.shape,
  async (args) => {
    const result = handlers.wisdom_create(args as z.infer<typeof WisdomCreateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'wisdom_get',
  'Get wisdom by ID or name',
  WisdomGetSchema.shape,
  async (args) => {
    const result = handlers.wisdom_get(args as z.infer<typeof WisdomGetSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'wisdom_search',
  'Search wisdom by query and domains',
  WisdomSearchSchema.shape,
  async (args) => {
    const result = handlers.wisdom_search(args as z.infer<typeof WisdomSearchSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'wisdom_apply',
  'Record wisdom application result',
  WisdomApplySchema.shape,
  async (args) => {
    const result = handlers.wisdom_apply(args as z.infer<typeof WisdomApplySchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// Unified High-Level Tools (simplified interface)
server.tool(
  'memory_store',
  'Store a memory (auto-selects working/episodic/semantic based on content)',
  UnifiedMemoryStoreSchema.shape,
  async (args) => {
    const result = handlers.memory_store(args as z.infer<typeof UnifiedMemoryStoreSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_update',
  'Update any memory type by ID',
  UnifiedMemoryUpdateSchema.shape,
  async (args) => {
    const result = handlers.memory_update(args as z.infer<typeof UnifiedMemoryUpdateSchema>);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'memory_forget',
  'Forget/delete a memory or apply decay',
  UnifiedMemoryForgetSchema.shape,
  async (args) => {
    const result = handlers.memory_forget(args as z.infer<typeof UnifiedMemoryForgetSchema>);
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
process.on('SIGINT', async () => {
  if (syncManager) {
    await syncManager.close();
  }
  memoryManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (syncManager) {
    await syncManager.close();
  }
  memoryManager.close();
  process.exit(0);
});

// Start server
async function main() {
  // Initialize Tachikoma if configured
  await initializeTachikoma();

  // Auto-sync from sync directory
  await autoSyncFromDirectory();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CC-Memory MCP server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
