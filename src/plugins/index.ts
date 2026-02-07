/**
 * Plugin System (A5)
 *
 * Enables extending cc-memory with custom tools, resources, and event handlers.
 */

export type {
  MemoryEventType,
  MemoryEvent,
  PluginToolDefinition,
  PluginResourceDefinition,
  MemoryPlugin,
  PluginRegistry,
} from './types.js';

export {
  PluginManager,
  getPluginManager,
  resetPluginManager,
} from './PluginManager.js';
