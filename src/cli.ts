#!/usr/bin/env node
/**
 * CC-Memory CLI Tool
 * Save transcripts from Claude Code Stop hooks
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { MemoryManager } from './memory/MemoryManager.js';
import type { Transcript, TranscriptMessage } from './memory/types.js';

// Configuration from environment
const DATA_PATH = process.env.CC_MEMORY_DATA_PATH || join(homedir(), '.claude-memory');
const HTTP_URL = process.env.CC_MEMORY_HTTP_URL || 'http://127.0.0.1:3000/mcp';
const API_KEY = process.env.CC_MEMORY_API_KEY;

interface ClaudeCodeMessage {
  type: string;
  message?: {
    type?: string;
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    text?: string;
    thinking?: string;
    name?: string;
    input?: unknown;
    id?: string;
  };
  timestamp?: number;
  sessionId?: string;
}

/**
 * Parse Claude Code JSONL transcript into cc-memory format
 */
function parseTranscript(transcriptPath: string): Transcript {
  if (!existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }

  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const transcript: Transcript = [];
  let currentAssistantMessage: TranscriptMessage | null = null;

  for (const line of lines) {
    try {
      const entry: ClaudeCodeMessage = JSON.parse(line);

      if (entry.type === 'user' && entry.message) {
        // Flush any pending assistant message
        if (currentAssistantMessage) {
          transcript.push(currentAssistantMessage);
          currentAssistantMessage = null;
        }

        // Extract user message content
        let content = '';
        if (entry.message.content && Array.isArray(entry.message.content)) {
          content = entry.message.content
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text)
            .join('\n');
        }

        if (content) {
          transcript.push({
            role: 'user',
            content,
            timestamp: entry.timestamp,
          });
        }
      } else if (entry.type === 'assistant' && entry.message) {
        const msg = entry.message;

        if (msg.type === 'text' && msg.text) {
          // Start or append to assistant message
          if (!currentAssistantMessage) {
            currentAssistantMessage = {
              role: 'assistant',
              content: msg.text,
              timestamp: entry.timestamp,
              toolCalls: [],
            };
          } else {
            currentAssistantMessage.content += '\n' + msg.text;
          }
        } else if (msg.type === 'tool_use' && msg.name) {
          // Add tool call to current assistant message
          if (!currentAssistantMessage) {
            currentAssistantMessage = {
              role: 'assistant',
              content: '',
              timestamp: entry.timestamp,
              toolCalls: [],
            };
          }
          currentAssistantMessage.toolCalls = currentAssistantMessage.toolCalls || [];
          currentAssistantMessage.toolCalls.push({
            name: msg.name,
            input: msg.input,
          });
        }
        // Skip 'thinking' type for now
      }
    } catch (e) {
      // Skip malformed lines
      console.error(`Warning: Failed to parse line: ${e}`);
    }
  }

  // Flush final assistant message
  if (currentAssistantMessage) {
    transcript.push(currentAssistantMessage);
  }

  return transcript;
}

/**
 * Try to save via HTTP API
 */
async function saveViaHttp(sessionId: string, transcript: Transcript): Promise<boolean> {
  if (!API_KEY) {
    return false;
  }

  try {
    // First, we need to initialize a session
    const initResponse = await fetch(HTTP_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cc-memory-cli', version: '1.0.0' },
        },
      }),
    });

    if (!initResponse.ok) {
      return false;
    }

    const mcpSessionId = initResponse.headers.get('mcp-session-id');
    if (!mcpSessionId) {
      return false;
    }

    // Now call episode_record tool
    const toolResponse = await fetch(HTTP_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'mcp-session-id': mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'episode_record',
          arguments: {
            type: 'interaction',
            summary: `Claude Code session: ${sessionId}`,
            details: 'Automatic transcript recording from Stop hook',
            transcript,
            importance: 5,
            tags: ['auto-recorded', 'claude-code', 'transcript'],
          },
        },
      }),
    });

    if (toolResponse.ok) {
      const result = await toolResponse.json() as { error?: unknown };
      if (!result.error) {
        console.log(`[cc-memory-cli] Saved via HTTP API (session: ${sessionId})`);
        return true;
      }
    }

    return false;
  } catch (e) {
    // HTTP failed, will fall back to direct SQLite
    return false;
  }
}

/**
 * Save directly to SQLite using MemoryManager
 */
async function saveViaSqlite(sessionId: string, transcript: Transcript): Promise<void> {
  const memoryManager = new MemoryManager({
    dataPath: DATA_PATH,
    sessionId: sessionId,
  });

  try {
    // Wait for storage to be ready
    await memoryManager.ready();

    // Use EpisodicMemory.record() method
    const episode = memoryManager.episodic.record({
      type: 'interaction',
      summary: `Claude Code session: ${sessionId}`,
      details: 'Automatic transcript recording from Stop hook',
      context: { taskId: 'cli-auto-record' },
      outcome: { status: 'success', learnings: [] },
      importance: 5,
      tags: ['auto-recorded', 'claude-code', 'transcript'],
      transcript,
    });

    console.log(`[cc-memory-cli] Saved via SQLite (session: ${sessionId}, episode: ${episode.id})`);
  } finally {
    memoryManager.close();
  }
}

/**
 * Main save-transcript command
 */
async function saveTranscript(sessionId: string, transcriptPath: string): Promise<void> {
  console.log(`[cc-memory-cli] Processing transcript for session: ${sessionId}`);
  console.log(`[cc-memory-cli] Transcript path: ${transcriptPath}`);

  // Parse transcript
  const transcript = parseTranscript(transcriptPath);
  console.log(`[cc-memory-cli] Parsed ${transcript.length} messages`);

  if (transcript.length === 0) {
    console.log('[cc-memory-cli] No messages to save, skipping');
    return;
  }

  // Try HTTP first, then fall back to SQLite
  const savedViaHttp = await saveViaHttp(sessionId, transcript);

  if (!savedViaHttp) {
    console.log('[cc-memory-cli] HTTP API not available, using direct SQLite');
    await saveViaSqlite(sessionId, transcript);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): { command: string; sessionId?: string; transcriptPath?: string } {
  const args = process.argv.slice(2);
  const result: { command: string; sessionId?: string; transcriptPath?: string } = {
    command: args[0] || 'help',
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--session-id' && args[i + 1]) {
      result.sessionId = args[++i];
    } else if (args[i] === '--transcript-path' && args[i + 1]) {
      result.transcriptPath = args[++i];
    }
  }

  return result;
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
cc-memory-cli - CLI tool for cc-memory

Usage:
  cc-memory-cli save-transcript --session-id <id> --transcript-path <path>

Commands:
  save-transcript   Save a Claude Code transcript to cc-memory

Options:
  --session-id      Claude Code session ID
  --transcript-path Path to the transcript JSONL file

Environment Variables:
  CC_MEMORY_DATA_PATH  Path to cc-memory data directory (default: ~/.claude-memory)
  CC_MEMORY_HTTP_URL   HTTP MCP server URL (default: http://127.0.0.1:3000/mcp)
  CC_MEMORY_API_KEY    API key for HTTP authentication
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, sessionId, transcriptPath } = parseArgs();

  switch (command) {
    case 'save-transcript':
      if (!sessionId || !transcriptPath) {
        console.error('Error: --session-id and --transcript-path are required');
        process.exit(1);
      }
      await saveTranscript(sessionId, transcriptPath);
      break;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('[cc-memory-cli] Error:', error);
  process.exit(1);
});
