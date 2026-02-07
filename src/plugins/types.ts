/**
 * Plugin System Types (A5)
 *
 * Enables extending cc-memory with new functionality without
 * modifying core files. Plugins can provide:
 * - Custom MCP tools
 * - Custom MCP resources
 * - Event handlers for memory operations
 */

import type { z } from 'zod';

// ============================================================================
// Memory Events
// ============================================================================

export type MemoryEventType =
  | 'working:created'
  | 'working:updated'
  | 'working:deleted'
  | 'episodic:created'
  | 'episodic:updated'
  | 'semantic:created'
  | 'semantic:updated'
  | 'pattern:created'
  | 'pattern:confirmed'
  | 'insight:created'
  | 'insight:validated'
  | 'wisdom:created'
  | 'goal:created'
  | 'goal:progress'
  | 'goal:completed'
  | 'consolidation:completed'
  | 'compression:completed';

export interface MemoryEvent<T = unknown> {
  type: MemoryEventType;
  timestamp: number;
  sessionId: string;
  data: T;
}

// ============================================================================
// Plugin Tool Definition
// ============================================================================

export interface PluginToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Tool name (should be prefixed with plugin name) */
  name: string;
  /** Tool description for MCP */
  description: string;
  /** Zod schema for input validation */
  schema: T;
  /** Handler function */
  handler: (args: z.infer<T>) => unknown | Promise<unknown>;
}

// ============================================================================
// Plugin Resource Definition
// ============================================================================

export interface PluginResourceDefinition {
  /** Resource URI pattern (e.g., "memory://plugin-name/resource") */
  uri: string;
  /** Resource name for display */
  name: string;
  /** Resource description */
  description: string;
  /** MIME type (default: application/json) */
  mimeType?: string;
  /** Handler to generate resource content */
  handler: () => string | Promise<string>;
}

// ============================================================================
// Plugin Interface
// ============================================================================

export interface MemoryPlugin {
  /** Unique plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** Plugin description */
  description: string;

  /** MCP tools provided by this plugin */
  tools?: PluginToolDefinition[];

  /** MCP resources provided by this plugin */
  resources?: PluginResourceDefinition[];

  /**
   * Event handler called when memory events occur.
   * Return value is ignored.
   */
  onEvent?: (event: MemoryEvent) => void | Promise<void>;

  /**
   * Called when plugin is loaded.
   * Can be used for initialization.
   */
  onLoad?: () => void | Promise<void>;

  /**
   * Called when plugin is unloaded.
   * Can be used for cleanup.
   */
  onUnload?: () => void | Promise<void>;
}

// ============================================================================
// Plugin Manager Interface
// ============================================================================

export interface PluginRegistry {
  /** Register a plugin */
  register(plugin: MemoryPlugin): void;

  /** Unregister a plugin by name */
  unregister(name: string): void;

  /** Get a plugin by name */
  get(name: string): MemoryPlugin | undefined;

  /** List all registered plugins */
  list(): MemoryPlugin[];

  /** Emit an event to all plugins */
  emit(event: MemoryEvent): void;

  /** Get all tools from all plugins */
  getAllTools(): PluginToolDefinition[];

  /** Get all resources from all plugins */
  getAllResources(): PluginResourceDefinition[];
}
