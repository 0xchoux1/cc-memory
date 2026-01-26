#!/usr/bin/env node
/**
 * CC-Memory CLI Tool
 * Multi-agent memory management and transcript recording
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { MemoryManager } from './memory/MemoryManager.js';
import type { Transcript, TranscriptMessage } from './memory/types.js';
import {
  loadApiKeysFromFile,
  saveApiKeysToFile,
  generateApiKey,
  hashApiKey,
  createTeamConfig,
  addApiKey,
  removeApiKey,
  listTeamAgents,
} from './server/http/auth/apiKey.js';
import type { ApiKeyInfoV2, PermissionLevel } from './server/http/auth/types.js';
import { DEFAULT_SCOPES } from './server/http/auth/types.js';

// Configuration from environment
const DATA_PATH = process.env.CC_MEMORY_DATA_PATH || join(homedir(), '.claude-memory');
const HTTP_URL = process.env.CC_MEMORY_HTTP_URL || 'http://127.0.0.1:3000/mcp';
const API_KEY = process.env.CC_MEMORY_API_KEY;
const API_KEYS_FILE = process.env.CC_MEMORY_API_KEYS_FILE || join(DATA_PATH, 'api-keys.json');

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

interface ParsedArgs {
  command: string;
  subcommand?: string;
  sessionId?: string;
  transcriptPath?: string;
  teamId?: string;
  clientId?: string;
  level?: PermissionLevel;
  managerId?: string;
  description?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const result: ParsedArgs = {
    command: args[0] || 'help',
  };

  // Check for subcommand (e.g., "team create")
  if (['team', 'agent', 'apikey'].includes(result.command) && args[1] && !args[1].startsWith('--')) {
    result.subcommand = args[1];
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--session-id':
        if (nextArg) result.sessionId = args[++i];
        break;
      case '--transcript-path':
        if (nextArg) result.transcriptPath = args[++i];
        break;
      case '--team-id':
        if (nextArg) result.teamId = args[++i];
        break;
      case '--client-id':
        if (nextArg) result.clientId = args[++i];
        break;
      case '--level':
        if (nextArg) result.level = args[++i] as PermissionLevel;
        break;
      case '--manager-id':
        if (nextArg) result.managerId = args[++i];
        break;
      case '--description':
        if (nextArg) result.description = args[++i];
        break;
    }
  }

  return result;
}

// ============================================================================
// Team and Agent Management Commands
// ============================================================================

/**
 * Create a new team
 */
function teamCreate(teamId: string, description?: string): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);

  if (config.teams.has(teamId)) {
    console.error(`Error: Team '${teamId}' already exists`);
    process.exit(1);
  }

  // Generate manager key
  const rawKey = generateApiKey();
  const managerId = `manager-${teamId}`;

  // Create team config
  const teamConfig = createTeamConfig(managerId, { description });
  config.teams.set(teamId, teamConfig);

  // Create manager API key
  const managerKeyInfo: ApiKeyInfoV2 = {
    clientId: managerId,
    permissionLevel: 'manager',
    scopes: ['memory:*'],
    team: teamId,
    managedAgents: [],
    createdAt: Date.now(),
  };
  addApiKey(config, rawKey, managerKeyInfo);

  // Ensure directory exists
  const dir = dirname(API_KEYS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Save config
  saveApiKeysToFile(API_KEYS_FILE, config);

  console.log(`Team created successfully!`);
  console.log(`  Team ID: ${teamId}`);
  console.log(`  Manager ID: ${managerId}`);
  console.log(`  Shared Pool: ${teamConfig.sharedPoolId}`);
  console.log(`  Description: ${description || '(none)'}`);
  console.log('');
  console.log('Manager API Key (save this - it will not be shown again):');
  console.log(`  ${rawKey}`);
}

/**
 * List all teams
 */
function teamList(): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);

  if (config.teams.size === 0) {
    console.log('No teams found.');
    return;
  }

  console.log('Teams:');
  console.log('------');
  for (const [teamId, teamConfig] of config.teams) {
    const agents = listTeamAgents(config, teamId);
    console.log(`\n[${teamId}]`);
    console.log(`  Manager: ${teamConfig.managerId}`);
    console.log(`  Shared Pool: ${teamConfig.sharedPoolId}`);
    console.log(`  Sync Mode: ${teamConfig.syncPolicy.mode}`);
    console.log(`  Agents: ${agents.length}`);
    if (teamConfig.description) {
      console.log(`  Description: ${teamConfig.description}`);
    }
  }
}

/**
 * Show team details
 */
function teamShow(teamId: string): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);
  const teamConfig = config.teams.get(teamId);

  if (!teamConfig) {
    console.error(`Error: Team '${teamId}' not found`);
    process.exit(1);
  }

  const agents = listTeamAgents(config, teamId);

  console.log(`Team: ${teamId}`);
  console.log('==================');
  console.log(`Manager ID: ${teamConfig.managerId}`);
  console.log(`Shared Pool ID: ${teamConfig.sharedPoolId}`);
  console.log(`Description: ${teamConfig.description || '(none)'}`);
  console.log(`Created: ${teamConfig.createdAt ? new Date(teamConfig.createdAt).toISOString() : '(unknown)'}`);
  console.log('');
  console.log('Sync Policy:');
  console.log(`  Mode: ${teamConfig.syncPolicy.mode}`);
  console.log(`  Batch Interval: ${teamConfig.syncPolicy.batchInterval}ms`);
  console.log(`  Conflict Resolution: ${teamConfig.syncPolicy.conflictResolution}`);
  console.log('');
  console.log('Agents:');
  console.log('-------');
  for (const agent of agents) {
    console.log(`  ${agent.clientId}`);
    console.log(`    Level: ${agent.permissionLevel}`);
    console.log(`    Scopes: ${agent.scopes.join(', ')}`);
    if (agent.managerId) {
      console.log(`    Manager: ${agent.managerId}`);
    }
    if (agent.managedAgents && agent.managedAgents.length > 0) {
      console.log(`    Managed Agents: ${agent.managedAgents.join(', ')}`);
    }
  }
}

/**
 * Add an agent to a team
 */
function agentAdd(
  teamId: string,
  clientId: string,
  level: PermissionLevel,
  managerId?: string
): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);
  const teamConfig = config.teams.get(teamId);

  if (!teamConfig) {
    console.error(`Error: Team '${teamId}' not found`);
    process.exit(1);
  }

  // Check if agent already exists
  for (const keyInfo of config.keys.values()) {
    if (keyInfo.clientId === clientId) {
      console.error(`Error: Agent '${clientId}' already exists`);
      process.exit(1);
    }
  }

  // Determine manager
  const actualManagerId = managerId || teamConfig.managerId;

  // Generate API key
  const rawKey = generateApiKey();
  const agentKeyInfo: ApiKeyInfoV2 = {
    clientId,
    permissionLevel: level,
    scopes: DEFAULT_SCOPES[level],
    team: teamId,
    managerId: level !== 'manager' ? actualManagerId : undefined,
    managedAgents: level === 'manager' ? [] : undefined,
    createdAt: Date.now(),
  };

  // Add to config
  addApiKey(config, rawKey, agentKeyInfo);

  // Update manager's managedAgents list
  if (level !== 'manager') {
    for (const [hash, keyInfo] of config.keys) {
      if (keyInfo.clientId === actualManagerId && keyInfo.managedAgents) {
        keyInfo.managedAgents.push(clientId);
        break;
      }
    }
  }

  // Save config
  saveApiKeysToFile(API_KEYS_FILE, config);

  console.log(`Agent added successfully!`);
  console.log(`  Team: ${teamId}`);
  console.log(`  Client ID: ${clientId}`);
  console.log(`  Level: ${level}`);
  console.log(`  Manager: ${level !== 'manager' ? actualManagerId : '(self)'}`);
  console.log('');
  console.log('API Key (save this - it will not be shown again):');
  console.log(`  ${rawKey}`);
}

/**
 * Remove an agent
 */
function agentRemove(clientId: string): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);

  // Find agent
  let agentInfo: ApiKeyInfoV2 | undefined;
  for (const keyInfo of config.keys.values()) {
    if (keyInfo.clientId === clientId) {
      agentInfo = keyInfo;
      break;
    }
  }

  if (!agentInfo) {
    console.error(`Error: Agent '${clientId}' not found`);
    process.exit(1);
  }

  // Check if manager has managed agents
  if (agentInfo.permissionLevel === 'manager' && agentInfo.managedAgents && agentInfo.managedAgents.length > 0) {
    console.error(`Error: Cannot remove manager '${clientId}' with active managed agents`);
    console.error(`  Managed agents: ${agentInfo.managedAgents.join(', ')}`);
    process.exit(1);
  }

  // Remove from manager's managedAgents list
  if (agentInfo.managerId) {
    for (const keyInfo of config.keys.values()) {
      if (keyInfo.clientId === agentInfo.managerId && keyInfo.managedAgents) {
        keyInfo.managedAgents = keyInfo.managedAgents.filter(id => id !== clientId);
        break;
      }
    }
  }

  // Remove agent
  const removed = removeApiKey(config, clientId);
  if (!removed) {
    console.error(`Error: Failed to remove agent '${clientId}'`);
    process.exit(1);
  }

  // Save config
  saveApiKeysToFile(API_KEYS_FILE, config);

  console.log(`Agent '${clientId}' removed successfully`);
}

/**
 * List all agents
 */
function agentList(teamId?: string): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);

  const agents = teamId ? listTeamAgents(config, teamId) : Array.from(config.keys.values());

  if (agents.length === 0) {
    console.log('No agents found.');
    return;
  }

  console.log(teamId ? `Agents in team '${teamId}':` : 'All agents:');
  console.log('-'.repeat(60));

  for (const agent of agents) {
    console.log(`\n${agent.clientId}`);
    console.log(`  Level: ${agent.permissionLevel}`);
    console.log(`  Team: ${agent.team || '(none)'}`);
    console.log(`  Scopes: ${agent.scopes.slice(0, 3).join(', ')}${agent.scopes.length > 3 ? '...' : ''}`);
    if (agent.managerId) {
      console.log(`  Manager: ${agent.managerId}`);
    }
    if (agent.managedAgents && agent.managedAgents.length > 0) {
      console.log(`  Managed: ${agent.managedAgents.join(', ')}`);
    }
  }
}

/**
 * Generate a new API key for an existing agent
 */
function apiKeyRegenerate(clientId: string): void {
  const config = loadApiKeysFromFile(API_KEYS_FILE);

  // Find agent
  let oldHash: string | undefined;
  let agentInfo: ApiKeyInfoV2 | undefined;
  for (const [hash, keyInfo] of config.keys) {
    if (keyInfo.clientId === clientId) {
      oldHash = hash;
      agentInfo = keyInfo;
      break;
    }
  }

  if (!agentInfo || !oldHash) {
    console.error(`Error: Agent '${clientId}' not found`);
    process.exit(1);
  }

  // Generate new key
  const rawKey = generateApiKey();
  const newHash = hashApiKey(rawKey);

  // Update config
  config.keys.delete(oldHash);
  config.keys.set(newHash, agentInfo);

  // Save config
  saveApiKeysToFile(API_KEYS_FILE, config);

  console.log(`API key regenerated for '${clientId}'`);
  console.log('');
  console.log('New API Key (save this - it will not be shown again):');
  console.log(`  ${rawKey}`);
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
cc-memory-cli - CLI tool for cc-memory

Usage:
  cc-memory-cli <command> [options]

Commands:
  save-transcript      Save a Claude Code transcript to cc-memory
  team create          Create a new team
  team list            List all teams
  team show            Show team details
  agent add            Add an agent to a team
  agent remove         Remove an agent
  agent list           List all agents
  apikey regenerate    Regenerate API key for an agent

Transcript Options:
  --session-id         Claude Code session ID
  --transcript-path    Path to the transcript JSONL file

Team Create Options:
  --team-id            Team ID (required)
  --description        Team description

Agent Add Options:
  --team-id            Team ID (required)
  --client-id          Agent client ID (required)
  --level              Permission level: manager, worker, observer (default: worker)
  --manager-id         Manager ID (optional, defaults to team manager)

Agent Remove Options:
  --client-id          Agent client ID (required)

Agent List Options:
  --team-id            Filter by team ID (optional)

API Key Regenerate Options:
  --client-id          Agent client ID (required)

Environment Variables:
  CC_MEMORY_DATA_PATH  Path to cc-memory data directory (default: ~/.claude-memory)
  CC_MEMORY_HTTP_URL   HTTP MCP server URL (default: http://127.0.0.1:3000/mcp)
  CC_MEMORY_API_KEY    API key for HTTP authentication

Examples:
  # Create a new team
  cc-memory-cli team create --team-id project-alpha --description "Alpha project team"

  # Add a worker agent
  cc-memory-cli agent add --team-id project-alpha --client-id worker-001 --level worker

  # List team members
  cc-memory-cli agent list --team-id project-alpha

  # Regenerate API key
  cc-memory-cli apikey regenerate --client-id worker-001
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const parsed = parseArgs();
  const { command, subcommand } = parsed;

  switch (command) {
    case 'save-transcript':
      if (!parsed.sessionId || !parsed.transcriptPath) {
        console.error('Error: --session-id and --transcript-path are required');
        process.exit(1);
      }
      await saveTranscript(parsed.sessionId, parsed.transcriptPath);
      break;

    case 'team':
      switch (subcommand) {
        case 'create':
          if (!parsed.teamId) {
            console.error('Error: --team-id is required');
            process.exit(1);
          }
          teamCreate(parsed.teamId, parsed.description);
          break;
        case 'list':
          teamList();
          break;
        case 'show':
          if (!parsed.teamId) {
            console.error('Error: --team-id is required');
            process.exit(1);
          }
          teamShow(parsed.teamId);
          break;
        default:
          console.error(`Unknown team subcommand: ${subcommand}`);
          showHelp();
          process.exit(1);
      }
      break;

    case 'agent':
      switch (subcommand) {
        case 'add':
          if (!parsed.teamId || !parsed.clientId) {
            console.error('Error: --team-id and --client-id are required');
            process.exit(1);
          }
          agentAdd(parsed.teamId, parsed.clientId, parsed.level || 'worker', parsed.managerId);
          break;
        case 'remove':
          if (!parsed.clientId) {
            console.error('Error: --client-id is required');
            process.exit(1);
          }
          agentRemove(parsed.clientId);
          break;
        case 'list':
          agentList(parsed.teamId);
          break;
        default:
          console.error(`Unknown agent subcommand: ${subcommand}`);
          showHelp();
          process.exit(1);
      }
      break;

    case 'apikey':
      switch (subcommand) {
        case 'regenerate':
          if (!parsed.clientId) {
            console.error('Error: --client-id is required');
            process.exit(1);
          }
          apiKeyRegenerate(parsed.clientId);
          break;
        default:
          console.error(`Unknown apikey subcommand: ${subcommand}`);
          showHelp();
          process.exit(1);
      }
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
