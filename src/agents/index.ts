/**
 * Agents Module
 *
 * Provides multi-agent coordination with A2A-inspired patterns.
 */

// AgentCoordinator
export {
  AgentCoordinator,
  type AgentStorage,
  type AgentStepExecutor,
  type DelegationResult,
  type SyncConfig,
} from './AgentCoordinator.js';

// WorkerAgent
export {
  type WorkerAgent,
  type WorkerAgentConfig,
  type WorkerAgentFactory,
  type WorkerAgentTool,
  type SharedContext,
  type ClaudeApiConfig,
  type ConversationMessage,
  type TaskExecutionDetails,
  type TaskArtifact,
  DEFAULT_API_CONFIG,
  resolveApiKey,
  generateDefaultSystemPrompt,
} from './WorkerAgent.js';

// ClaudeWorkerAgent (API Key mode)
export {
  ClaudeWorkerAgent,
  ClaudeWorkerAgentFactory,
} from './ClaudeWorkerAgent.js';

// ClaudeCodeWorkerAgent (Subscription mode - uses Claude Code CLI)
export {
  ClaudeCodeWorkerAgent,
  ClaudeCodeWorkerAgentFactory,
  type ClaudeCodeConfig,
  DEFAULT_CLAUDE_CODE_CONFIG,
} from './ClaudeCodeWorkerAgent.js';

// AgentManager
export {
  AgentManager,
  type IAgentManager,
  type AgentManagerConfig,
  type ProgressUpdate,
  type ProgressUpdateType,
  type HumanQuestion,
} from './AgentManager.js';

// WorkerAgentExecutor
export {
  WorkerAgentExecutor,
  HITLExecutorWrapper,
  MockStepExecutor,
  type WorkerAgentExecutorConfig,
} from './WorkerAgentExecutor.js';

// Templates
export {
  ROLE_SYSTEM_PROMPTS,
  ROLE_DEFAULT_CAPABILITIES,
  ROLE_DEFAULT_SPECIALIZATIONS,
  PRESET_AGENTS,
  createDefaultProfile,
  createDefaultConfig,
} from './templates/index.js';
