/**
 * Durable Execution Types for A2A-style Multi-Agent Workflows
 *
 * This module provides types for implementing durable, resumable workflows
 * that can survive crashes and support human-in-the-loop interactions.
 *
 * Design based on:
 * - A2A Protocol concepts (Task state transitions, Agent capabilities)
 * - Durable Execution patterns (Temporal, Inngest, Restate)
 * - cc-memory integration (Working Memory, Episodic Memory, Tachikoma)
 */

import type { AgentRole } from '../memory/types.js';

// ============================================================================
// Step Types
// ============================================================================

/**
 * Status of a workflow step
 *
 * State transitions:
 * pending -> in_progress -> completed | failed | waiting
 * waiting -> in_progress (on resume)
 */
export type StepStatus =
  | 'pending'      // Not yet started
  | 'in_progress'  // Currently executing
  | 'completed'    // Successfully finished
  | 'failed'       // Failed with error
  | 'waiting';     // Waiting for external input (HITL)

/**
 * A single step in a durable workflow
 */
export interface DurableStep {
  /** Unique identifier for this step */
  id: string;

  /** Human-readable name of the step */
  name: string;

  /** Agent responsible for executing this step */
  agent: string;

  /** Agent role (for capability matching) */
  agentRole?: AgentRole;

  /** Current status of the step */
  status: StepStatus;

  /** Input data for the step */
  input?: unknown;

  /** Output data from the step */
  output?: unknown;

  /** Error information if step failed */
  error?: StepError;

  /** Timestamp when step started */
  startedAt?: number;

  /** Timestamp when step completed */
  completedAt?: number;

  /** Number of retry attempts */
  retryCount?: number;

  /** Maximum retry attempts allowed */
  maxRetries?: number;

  /** Dependencies on other steps (step IDs) */
  dependsOn?: string[];

  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Error information for a failed step
 */
export interface StepError {
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Status of the overall workflow
 */
export type WorkflowStatus =
  | 'pending'    // Created but not started
  | 'running'    // Currently executing
  | 'paused'     // Paused (HITL or manual)
  | 'completed'  // All steps completed successfully
  | 'failed'     // Workflow failed
  | 'cancelled'; // Workflow was cancelled

/**
 * A durable workflow containing multiple steps
 */
export interface DurableWorkflow {
  /** Unique identifier for this workflow */
  id: string;

  /** Context ID for grouping related workflows (A2A concept) */
  contextId: string;

  /** Human-readable name of the workflow */
  name: string;

  /** Description of what this workflow does */
  description?: string;

  /** Ordered list of steps */
  steps: DurableStep[];

  /** Index of the current step being executed */
  currentStepIndex: number;

  /** Overall workflow status */
  status: WorkflowStatus;

  /** Input data for the workflow */
  input?: unknown;

  /** Final output from the workflow */
  output?: unknown;

  /** Error information if workflow failed */
  error?: StepError;

  /** Timestamp when workflow was created */
  createdAt: number;

  /** Timestamp when workflow was last updated */
  updatedAt: number;

  /** Timestamp when workflow started executing */
  startedAt?: number;

  /** Timestamp when workflow completed */
  completedAt?: number;

  /** Metadata for workflow management */
  metadata?: WorkflowMetadata;
}

/**
 * Metadata for workflow management
 */
export interface WorkflowMetadata {
  /** User or system that initiated the workflow */
  initiator?: string;

  /** Priority level */
  priority?: 'low' | 'medium' | 'high' | 'critical';

  /** Tags for categorization */
  tags?: string[];

  /** Custom properties */
  properties?: Record<string, unknown>;

  /** Parent workflow ID (for nested workflows) */
  parentWorkflowId?: string;
}

// ============================================================================
// Agent Card Types (A2A-inspired)
// ============================================================================

/**
 * Agent capability description (A2A Agent Card concept)
 */
export interface AgentCapability {
  /** Capability name */
  name: string;

  /** Description of what the agent can do */
  description: string;

  /** Input schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;

  /** Output schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;

  /** Whether this capability is available */
  available: boolean;
}

/**
 * Agent Card - describes an agent's capabilities and metadata
 * Inspired by A2A Protocol's Agent Card concept
 */
export interface AgentCard {
  /** Unique agent identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Agent role */
  role: AgentRole;

  /** Agent description */
  description: string;

  /** List of capabilities */
  capabilities: AgentCapability[];

  /** Specializations */
  specializations: string[];

  /** Knowledge domains */
  knowledgeDomains: string[];

  /** Version of the agent */
  version?: string;

  /** Whether the agent is currently active */
  active: boolean;

  /** Last activity timestamp */
  lastActiveAt: number;
}

// ============================================================================
// Task Types (A2A-inspired)
// ============================================================================

/**
 * Task status following A2A Protocol conventions
 */
export type TaskStatus =
  | 'submitted'       // Task has been submitted
  | 'working'         // Task is being processed
  | 'input_required'  // Waiting for user input (HITL)
  | 'auth_required'   // Waiting for authentication
  | 'completed'       // Task completed successfully
  | 'failed'          // Task failed
  | 'cancelled'       // Task was cancelled
  | 'rejected';       // Task was rejected by agent

/**
 * A task that can be delegated between agents (A2A concept)
 */
export interface DurableTask {
  /** Unique task identifier */
  id: string;

  /** Context ID for grouping related tasks */
  contextId: string;

  /** Current status */
  status: TaskStatus;

  /** Task summary */
  summary: string;

  /** Detailed description */
  description?: string;

  /** Agent that created the task */
  createdBy: string;

  /** Agent assigned to execute the task */
  assignedTo?: string;

  /** Agent that delegated this task */
  delegatedFrom?: string;

  /** Messages exchanged during task execution */
  messages: TaskMessage[];

  /** Artifacts produced by the task */
  artifacts?: TaskArtifact[];

  /** Timestamp when task was created */
  createdAt: number;

  /** Timestamp when task was last updated */
  updatedAt: number;

  /** Reference to related tasks */
  relatedTaskIds?: string[];
}

/**
 * A message within a task (A2A Message concept)
 */
export interface TaskMessage {
  /** Message identifier */
  id: string;

  /** Role of the sender */
  role: 'user' | 'agent';

  /** Agent ID if role is 'agent' */
  agentId?: string;

  /** Message parts (for multimodal content) */
  parts: TaskMessagePart[];

  /** Timestamp when message was sent */
  timestamp: number;
}

/**
 * A part of a message (A2A Part concept)
 */
export interface TaskMessagePart {
  /** Type of content */
  type: 'text' | 'file' | 'data';

  /** Content value */
  content: string;

  /** MIME type for file parts */
  mimeType?: string;

  /** Name for file parts */
  name?: string;
}

/**
 * An artifact produced by a task (A2A Artifact concept)
 */
export interface TaskArtifact {
  /** Artifact identifier */
  id: string;

  /** Artifact name */
  name: string;

  /** Content parts */
  parts: TaskMessagePart[];

  /** Version number for iterative artifacts */
  version: number;

  /** Timestamp when artifact was created */
  createdAt: number;
}

// ============================================================================
// Workflow Execution Types
// ============================================================================

/**
 * Result of executing a single step
 */
export interface StepExecutionResult {
  /** Step ID that was executed */
  stepId: string;

  /** Whether execution was successful */
  success: boolean;

  /** Output from the step */
  output?: unknown;

  /** Error if execution failed */
  error?: StepError;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Whether the step is waiting for external input */
  waiting: boolean;

  /** Message if waiting */
  waitingMessage?: string;
}

/**
 * Result of executing a workflow
 */
export interface WorkflowExecutionResult {
  /** Workflow ID that was executed */
  workflowId: string;

  /** Whether workflow completed successfully */
  success: boolean;

  /** Final output from the workflow */
  output?: unknown;

  /** Error if workflow failed */
  error?: StepError;

  /** Total execution duration in milliseconds */
  durationMs: number;

  /** Results for each step */
  stepResults: StepExecutionResult[];

  /** Whether workflow is paused */
  paused: boolean;

  /** Index of step where workflow paused (if paused) */
  pausedAtStep?: number;
}

// ============================================================================
// Workflow Definition Types
// ============================================================================

/**
 * Definition for a step in a workflow template
 */
export interface StepDefinition {
  /** Step name */
  name: string;

  /** Agent to execute the step */
  agent: string;

  /** Agent role */
  agentRole?: AgentRole;

  /** Dependencies on other steps */
  dependsOn?: string[];

  /** Maximum retry attempts */
  maxRetries?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Whether this is a HITL step */
  waitForHuman?: boolean;
}

/**
 * Template for creating workflows
 */
export interface WorkflowDefinition {
  /** Template name */
  name: string;

  /** Description */
  description?: string;

  /** Step definitions */
  steps: StepDefinition[];

  /** Default metadata */
  defaultMetadata?: WorkflowMetadata;
}

// ============================================================================
// Sync Types for Multi-Agent Coordination
// ============================================================================

/**
 * Sync state for a workflow step
 */
export interface StepSyncState {
  /** Step ID */
  stepId: string;

  /** Workflow ID */
  workflowId: string;

  /** Status at sync time */
  status: StepStatus;

  /** Output at sync time */
  output?: unknown;

  /** Agent that executed the step */
  executedBy?: string;

  /** Sync timestamp */
  syncedAt: number;

  /** Tachikoma ID of the syncing instance */
  tachikomaId: string;
}

/**
 * Workflow sync delta for Tachikoma parallelization
 */
export interface WorkflowSyncDelta {
  /** Workflow ID */
  workflowId: string;

  /** Changed steps since last sync */
  changedSteps: StepSyncState[];

  /** Current workflow status */
  status: WorkflowStatus;

  /** Current step index */
  currentStepIndex: number;

  /** Export timestamp */
  exportedAt: number;

  /** Source Tachikoma ID */
  tachikomaId: string;
}
