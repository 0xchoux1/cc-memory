/**
 * Plugin System tests (A5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  PluginManager,
  getPluginManager,
  resetPluginManager,
  type MemoryPlugin,
  type MemoryEvent,
} from '../../src/plugins/index.js';
import { DiagnosticsPlugin } from '../../src/plugins/examples/DiagnosticsPlugin.js';

describe('Plugin System (A5)', () => {
  let manager: PluginManager;

  beforeEach(() => {
    resetPluginManager();
    manager = new PluginManager('test-session');
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('PluginManager', () => {
    it('should register a plugin', async () => {
      const plugin: MemoryPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
      };

      await manager.register(plugin);

      expect(manager.get('test-plugin')).toBe(plugin);
    });

    it('should throw when registering duplicate plugin', async () => {
      const plugin: MemoryPlugin = {
        name: 'duplicate',
        version: '1.0.0',
        description: 'Duplicate test',
      };

      await manager.register(plugin);

      await expect(manager.register(plugin)).rejects.toThrow('already registered');
    });

    it('should unregister a plugin', async () => {
      const plugin: MemoryPlugin = {
        name: 'unregister-test',
        version: '1.0.0',
        description: 'Test',
      };

      await manager.register(plugin);
      await manager.unregister('unregister-test');

      expect(manager.get('unregister-test')).toBeUndefined();
    });

    it('should throw when unregistering non-existent plugin', async () => {
      await expect(manager.unregister('non-existent')).rejects.toThrow('not registered');
    });

    it('should list all plugins', async () => {
      const plugin1: MemoryPlugin = {
        name: 'plugin-1',
        version: '1.0.0',
        description: 'First',
      };

      const plugin2: MemoryPlugin = {
        name: 'plugin-2',
        version: '2.0.0',
        description: 'Second',
      };

      await manager.register(plugin1);
      await manager.register(plugin2);

      const plugins = manager.list();
      expect(plugins).toHaveLength(2);
      expect(plugins.map(p => p.name)).toContain('plugin-1');
      expect(plugins.map(p => p.name)).toContain('plugin-2');
    });

    it('should call onLoad when registering', async () => {
      let loaded = false;

      const plugin: MemoryPlugin = {
        name: 'load-test',
        version: '1.0.0',
        description: 'Test onLoad',
        onLoad: () => {
          loaded = true;
        },
      };

      await manager.register(plugin);
      expect(loaded).toBe(true);
    });

    it('should call onUnload when unregistering', async () => {
      let unloaded = false;

      const plugin: MemoryPlugin = {
        name: 'unload-test',
        version: '1.0.0',
        description: 'Test onUnload',
        onUnload: () => {
          unloaded = true;
        },
      };

      await manager.register(plugin);
      await manager.unregister('unload-test');

      expect(unloaded).toBe(true);
    });

    it('should validate plugin structure', async () => {
      const invalidPlugin = {
        // Missing name
        version: '1.0.0',
        description: 'Invalid',
      } as unknown as MemoryPlugin;

      await expect(manager.register(invalidPlugin)).rejects.toThrow('must have a name');
    });
  });

  describe('Event System', () => {
    it('should emit events to all plugins', async () => {
      const receivedEvents: MemoryEvent[] = [];

      const plugin: MemoryPlugin = {
        name: 'event-receiver',
        version: '1.0.0',
        description: 'Receives events',
        onEvent: (event) => {
          receivedEvents.push(event);
        },
      };

      await manager.register(plugin);

      manager.emit({
        type: 'episodic:created',
        timestamp: Date.now(),
        sessionId: 'test',
        data: { id: '123' },
      });

      // Give async handlers time to run
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('episodic:created');
    });

    it('should emit to multiple plugins', async () => {
      let count = 0;

      const plugin1: MemoryPlugin = {
        name: 'counter-1',
        version: '1.0.0',
        description: 'Counter 1',
        onEvent: () => { count++; },
      };

      const plugin2: MemoryPlugin = {
        name: 'counter-2',
        version: '1.0.0',
        description: 'Counter 2',
        onEvent: () => { count++; },
      };

      await manager.register(plugin1);
      await manager.register(plugin2);

      manager.emit({
        type: 'working:created',
        timestamp: Date.now(),
        sessionId: 'test',
        data: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(count).toBe(2);
    });

    it('should handle errors in event handlers', async () => {
      const plugin: MemoryPlugin = {
        name: 'error-plugin',
        version: '1.0.0',
        description: 'Throws errors',
        onEvent: () => {
          throw new Error('Test error');
        },
      };

      await manager.register(plugin);

      // Should not throw
      expect(() => {
        manager.emit({
          type: 'semantic:created',
          timestamp: Date.now(),
          sessionId: 'test',
          data: {},
        });
      }).not.toThrow();
    });
  });

  describe('Tools', () => {
    it('should collect tools from all plugins', async () => {
      const plugin1: MemoryPlugin = {
        name: 'tools-plugin-1',
        version: '1.0.0',
        description: 'Has tools',
        tools: [
          {
            name: 'tool_a',
            description: 'Tool A',
            schema: z.object({}),
            handler: () => ({ result: 'a' }),
          },
        ],
      };

      const plugin2: MemoryPlugin = {
        name: 'tools-plugin-2',
        version: '1.0.0',
        description: 'Has more tools',
        tools: [
          {
            name: 'tool_b',
            description: 'Tool B',
            schema: z.object({}),
            handler: () => ({ result: 'b' }),
          },
        ],
      };

      await manager.register(plugin1);
      await manager.register(plugin2);

      const tools = manager.getAllTools();
      expect(tools).toHaveLength(2);
    });

    it('should prefix tool names with plugin name', async () => {
      const plugin: MemoryPlugin = {
        name: 'prefix-test',
        version: '1.0.0',
        description: 'Test prefixing',
        tools: [
          {
            name: 'my_tool',
            description: 'My tool',
            schema: z.object({}),
            handler: () => ({}),
          },
        ],
      };

      await manager.register(plugin);

      const tools = manager.getAllTools();
      expect(tools[0].name).toBe('prefix-test_my_tool');
    });

    it('should not double-prefix already prefixed tools', async () => {
      const plugin: MemoryPlugin = {
        name: 'no-double',
        version: '1.0.0',
        description: 'Test no double prefix',
        tools: [
          {
            name: 'no-double_my_tool',
            description: 'Already prefixed',
            schema: z.object({}),
            handler: () => ({}),
          },
        ],
      };

      await manager.register(plugin);

      const tools = manager.getAllTools();
      expect(tools[0].name).toBe('no-double_my_tool');
    });
  });

  describe('Resources', () => {
    it('should collect resources from all plugins', async () => {
      const plugin: MemoryPlugin = {
        name: 'resource-plugin',
        version: '1.0.0',
        description: 'Has resources',
        resources: [
          {
            uri: 'memory://test/resource',
            name: 'Test Resource',
            description: 'A test resource',
            handler: () => '{"test": true}',
          },
        ],
      };

      await manager.register(plugin);

      const resources = manager.getAllResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('memory://test/resource');
    });

    it('should call resource handler', async () => {
      const plugin: MemoryPlugin = {
        name: 'handler-test',
        version: '1.0.0',
        description: 'Test handler',
        resources: [
          {
            uri: 'memory://handler/test',
            name: 'Handler Test',
            description: 'Tests handler',
            handler: () => JSON.stringify({ value: 42 }),
          },
        ],
      };

      await manager.register(plugin);

      const resources = manager.getAllResources();
      const content = await resources[0].handler();

      expect(JSON.parse(content)).toEqual({ value: 42 });
    });
  });

  describe('DiagnosticsPlugin Example', () => {
    it('should register and work correctly', async () => {
      await manager.register(DiagnosticsPlugin);

      expect(manager.get('diagnostics')).toBeDefined();
      expect(manager.getAllTools().length).toBeGreaterThan(0);
      expect(manager.getAllResources().length).toBeGreaterThan(0);
    });

    it('should log events', async () => {
      await manager.register(DiagnosticsPlugin);

      // Emit some events
      manager.emit({ type: 'episodic:created', timestamp: Date.now(), sessionId: 'test', data: {} });
      manager.emit({ type: 'semantic:created', timestamp: Date.now(), sessionId: 'test', data: {} });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Use the event_log tool
      const tools = manager.getAllTools();
      const eventLogTool = tools.find(t => t.name.includes('event_log'));
      expect(eventLogTool).toBeDefined();

      const result = await eventLogTool!.handler({ limit: 10 }) as any;
      expect(result.events.length).toBe(2);
    });
  });

  describe('Singleton Factory', () => {
    it('should return same instance', () => {
      resetPluginManager();

      const instance1 = getPluginManager('session-1');
      const instance2 = getPluginManager('session-2');

      // Same instance, but sessionId should be updated
      expect(instance2.getSessionId()).toBe('session-2');
    });

    it('should reset correctly', async () => {
      resetPluginManager();

      const instance = getPluginManager('test');
      await instance.register({
        name: 'reset-test',
        version: '1.0.0',
        description: 'Test reset',
      });

      resetPluginManager();

      const newInstance = getPluginManager('new-test');
      expect(newInstance.list()).toHaveLength(0);
    });
  });
});
