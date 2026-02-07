/**
 * Example Plugin: Diagnostics
 *
 * Provides diagnostic information about the memory system.
 * Demonstrates how to create a plugin with tools and resources.
 */

import { z } from 'zod';
import type { MemoryPlugin, MemoryEvent } from '../types.js';

// Track events for diagnostics
const eventLog: Array<{ type: string; timestamp: number }> = [];
const MAX_EVENT_LOG = 100;

export const DiagnosticsPlugin: MemoryPlugin = {
  name: 'diagnostics',
  version: '1.0.0',
  description: 'Provides diagnostic information about memory operations',

  tools: [
    {
      name: 'event_log',
      description: 'Get recent memory events log',
      schema: z.object({
        limit: z.number().min(1).max(100).optional().default(20)
          .describe('Maximum number of events to return'),
        type_filter: z.string().optional()
          .describe('Filter by event type (partial match)'),
      }),
      handler: (args) => {
        let events = eventLog.slice(-args.limit).reverse();

        if (args.type_filter) {
          events = events.filter(e =>
            e.type.toLowerCase().includes(args.type_filter!.toLowerCase())
          );
        }

        return {
          success: true,
          events,
          total: eventLog.length,
        };
      },
    },
    {
      name: 'health',
      description: 'Check plugin system health',
      schema: z.object({}),
      handler: () => {
        return {
          success: true,
          status: 'healthy',
          uptime: Date.now() - (eventLog[0]?.timestamp || Date.now()),
          eventCount: eventLog.length,
        };
      },
    },
  ],

  resources: [
    {
      uri: 'memory://diagnostics/status',
      name: 'Diagnostics Status',
      description: 'Current diagnostics status and statistics',
      handler: () => {
        const typeCounts: Record<string, number> = {};
        for (const event of eventLog) {
          typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
        }

        return JSON.stringify({
          totalEvents: eventLog.length,
          eventsByType: typeCounts,
          lastEvent: eventLog[eventLog.length - 1],
        }, null, 2);
      },
    },
  ],

  onEvent: (event: MemoryEvent) => {
    // Log the event
    eventLog.push({
      type: event.type,
      timestamp: event.timestamp,
    });

    // Trim if too long
    if (eventLog.length > MAX_EVENT_LOG) {
      eventLog.shift();
    }
  },

  onLoad: () => {
    console.log('[DiagnosticsPlugin] Loaded');
    eventLog.length = 0; // Clear on load
  },

  onUnload: () => {
    console.log('[DiagnosticsPlugin] Unloaded');
    eventLog.length = 0;
  },
};

export default DiagnosticsPlugin;
