/**
 * Plugin Manager (A5)
 *
 * Manages plugin registration, lifecycle, and event distribution.
 */

import type {
  MemoryPlugin,
  PluginRegistry,
  MemoryEvent,
  PluginToolDefinition,
  PluginResourceDefinition,
} from './types.js';

export class PluginManager implements PluginRegistry {
  private plugins: Map<string, MemoryPlugin> = new Map();
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Register a plugin
   */
  async register(plugin: MemoryPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Validate plugin
    this.validatePlugin(plugin);

    // Call onLoad if provided
    if (plugin.onLoad) {
      await plugin.onLoad();
    }

    this.plugins.set(plugin.name, plugin);
    console.log(`[PluginManager] Registered plugin: ${plugin.name} v${plugin.version}`);
  }

  /**
   * Unregister a plugin by name
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" is not registered`);
    }

    // Call onUnload if provided
    if (plugin.onUnload) {
      await plugin.onUnload();
    }

    this.plugins.delete(name);
    console.log(`[PluginManager] Unregistered plugin: ${name}`);
  }

  /**
   * Get a plugin by name
   */
  get(name: string): MemoryPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * List all registered plugins
   */
  list(): MemoryPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Emit an event to all plugins
   */
  emit(event: MemoryEvent): void {
    // Ensure event has required fields
    const fullEvent: MemoryEvent = {
      ...event,
      timestamp: event.timestamp || Date.now(),
      sessionId: event.sessionId || this.sessionId,
    };

    // Notify all plugins asynchronously
    for (const plugin of this.plugins.values()) {
      if (plugin.onEvent) {
        try {
          // Fire and forget - don't await
          Promise.resolve(plugin.onEvent(fullEvent)).catch(err => {
            console.error(`[PluginManager] Error in plugin "${plugin.name}" event handler:`, err);
          });
        } catch (err) {
          console.error(`[PluginManager] Error in plugin "${plugin.name}" event handler:`, err);
        }
      }
    }
  }

  /**
   * Get all tools from all plugins
   */
  getAllTools(): PluginToolDefinition[] {
    const tools: PluginToolDefinition[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.tools) {
        for (const tool of plugin.tools) {
          // Prefix tool name with plugin name if not already prefixed
          const prefixedName = tool.name.startsWith(`${plugin.name}_`)
            ? tool.name
            : `${plugin.name}_${tool.name}`;

          tools.push({
            ...tool,
            name: prefixedName,
          });
        }
      }
    }

    return tools;
  }

  /**
   * Get all resources from all plugins
   */
  getAllResources(): PluginResourceDefinition[] {
    const resources: PluginResourceDefinition[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.resources) {
        resources.push(...plugin.resources);
      }
    }

    return resources;
  }

  /**
   * Set session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Validate plugin structure
   */
  private validatePlugin(plugin: MemoryPlugin): void {
    if (!plugin.name || typeof plugin.name !== 'string') {
      throw new Error('Plugin must have a name');
    }

    if (!plugin.version || typeof plugin.version !== 'string') {
      throw new Error('Plugin must have a version');
    }

    if (plugin.tools) {
      for (const tool of plugin.tools) {
        if (!tool.name || !tool.description || !tool.schema || !tool.handler) {
          throw new Error(`Invalid tool definition in plugin "${plugin.name}"`);
        }
      }
    }

    if (plugin.resources) {
      for (const resource of plugin.resources) {
        if (!resource.uri || !resource.name || !resource.handler) {
          throw new Error(`Invalid resource definition in plugin "${plugin.name}"`);
        }
      }
    }
  }

  /**
   * Close all plugins
   */
  async close(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.onUnload) {
          await plugin.onUnload();
        }
      } catch (err) {
        console.error(`[PluginManager] Error unloading plugin "${name}":`, err);
      }
    }
    this.plugins.clear();
  }
}

// Export singleton factory
let instance: PluginManager | null = null;

export function getPluginManager(sessionId?: string): PluginManager {
  if (!instance) {
    instance = new PluginManager(sessionId || 'default');
  } else if (sessionId) {
    instance.setSessionId(sessionId);
  }
  return instance;
}

export function resetPluginManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
