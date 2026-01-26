# Multi-Agent Memory Sharing Guide

This guide explains how to use cc-memory's multi-agent features for secure memory sharing between AI agents.

## Overview

cc-memory supports hierarchical team-based memory sharing with:

- **Permission Model**: Manager, Worker, and Observer roles
- **Shared Memory Pool**: Team-wide memory accessible by all team members
- **Real-time Sync**: WebSocket-based synchronization
- **Audit Logging**: Full traceability of cross-agent access
- **CRDT Conflict Resolution**: Automatic handling of concurrent updates

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │           Team: project-alpha         │
                    ├──────────────────────────────────────┤
                    │                                      │
  ┌─────────────────┼──────────────────────────────────────┼─────────────────┐
  │                 │                                      │                 │
  │   ┌─────────────┴─────────────┐                        │                 │
  │   │     Manager Agent         │                        │                 │
  │   │  (Full team access)       │                        │                 │
  │   └─────────────┬─────────────┘                        │                 │
  │                 │ manages                              │                 │
  │   ┌─────────────┴─────────────┐                        │                 │
  │   │                           │                        │                 │
  │ ┌─┴───────────┐ ┌─────────────┴─┐ ┌─────────────────┐ │                 │
  │ │ Worker-001  │ │  Worker-002   │ │   Observer-001  │ │                 │
  │ │ (Read/Write)│ │  (Read/Write) │ │   (Read only)   │ │                 │
  │ └──────┬──────┘ └───────┬───────┘ └────────┬────────┘ │                 │
  │        │                │                  │          │                 │
  │        └────────────────┼──────────────────┘          │                 │
  │                         │                              │                 │
  │                         ▼                              │                 │
  │            ┌────────────────────────┐                  │                 │
  │            │    Shared Memory Pool   │                  │                 │
  │            │   (team:project-alpha)  │                  │                 │
  │            └────────────────────────┘                  │                 │
  │                                                        │                 │
  └────────────────────────────────────────────────────────┘                 │
                                                                             │
                           Private Memory (per agent)                        │
  ┌─────────────────────────────────────────────────────────────────────────┘
  │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  │ worker-001   │  │ worker-002   │  │ observer-001 │
  │  │   memory     │  │   memory     │  │   memory     │
  │  └──────────────┘  └──────────────┘  └──────────────┘
```

## Permission Levels

| Level | Private Memory | Shared Pool | Team Members' Memory |
|-------|---------------|-------------|---------------------|
| **Manager** | Full access | Read/Write | Read/Write managed agents |
| **Worker** | Full access | Read/Write | None (self only) |
| **Observer** | Read only | Read only | None |

### Scopes

- `memory:read` - Read own memory
- `memory:write` - Write own memory
- `memory:share:read` - Read shared pool
- `memory:share:write` - Write to shared pool
- `memory:team:read` - Read team members' memory
- `memory:team:write` - Write to team members' memory
- `memory:manage` - Manage permissions and team settings
- `memory:*` - All permissions (manager shorthand)

## Quick Start

### 1. Create a Team

```bash
# Using CLI
cc-memory-cli team create --team-id project-alpha --description "Alpha project team"
```

This creates:
- A new team configuration
- A manager agent with full permissions
- A shared memory pool

Save the generated API key for the manager agent.

### 2. Add Agents (Two Methods)

#### Method A: CLI (Local access required)

```bash
# Add a worker agent
cc-memory-cli agent add --team-id project-alpha --client-id worker-001 --level worker

# Add an observer agent
cc-memory-cli agent add --team-id project-alpha --client-id observer-001 --level observer
```

#### Method B: Self-Service Registration (No SSH required)

Managers can create invite codes that agents use to self-register via HTTP:

**Step 1: Manager creates an invite code**
```bash
curl -X POST "http://server:3000/api/invites" \
  -H "Authorization: Bearer MANAGER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "worker",
    "maxUses": 10,
    "expiresInHours": 24,
    "description": "Invite for project team workers"
  }'
```

Response:
```json
{
  "success": true,
  "invite": {
    "code": "inv_abc123...",
    "teamId": "project-alpha",
    "permissionLevel": "worker",
    "expiresAt": 1706000000000,
    "maxUses": 10
  },
  "registrationUrl": "POST /register with {\"inviteCode\": \"inv_abc123...\", \"clientId\": \"your-agent-id\"}"
}
```

**Step 2: New agent registers with the invite code**
```bash
curl -X POST "http://server:3000/register" \
  -H "Content-Type: application/json" \
  -d '{
    "inviteCode": "inv_abc123...",
    "clientId": "new-worker-001"
  }'
```

Response:
```json
{
  "success": true,
  "apiKey": "ccm_xyz789...",
  "clientId": "new-worker-001",
  "team": "project-alpha",
  "permissionLevel": "worker",
  "scopes": ["memory:read", "memory:write", "memory:share:read", "memory:share:write"]
}
```

**Step 3: Agent configures cc-memory with the received API key**

### 3. Configure Claude Code

Configure each Claude instance with its API key:

```json
{
  "mcpServers": {
    "cc-memory": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer ccm_your_api_key_here"
      }
    }
  }
}
```

### 4. Start the Server

```bash
# Start HTTP + WebSocket server
npm run start:http
```

The server provides:
- HTTP: `http://localhost:3000/mcp` (MCP protocol)
- WebSocket: `ws://localhost:3000/sync` (real-time sync)
- Health: `http://localhost:3000/health`

## API Keys Configuration File

The v2.0 API keys file (`~/.claude-memory/api-keys.json`) supports teams:

```json
{
  "version": "2.0",
  "teams": {
    "project-alpha": {
      "managerId": "manager-project-alpha",
      "sharedPoolId": "shared-pool-xyz",
      "syncPolicy": {
        "mode": "event-driven",
        "batchInterval": 5000,
        "conflictResolution": "merge_learnings"
      },
      "createdAt": 1706000000000,
      "description": "Alpha project team"
    }
  },
  "keys": {
    "sha256:abc123...": {
      "clientId": "manager-project-alpha",
      "permissionLevel": "manager",
      "scopes": ["memory:*"],
      "team": "project-alpha",
      "managedAgents": ["worker-001", "worker-002", "observer-001"],
      "createdAt": 1706000000000
    },
    "sha256:def456...": {
      "clientId": "worker-001",
      "permissionLevel": "worker",
      "scopes": ["memory:read", "memory:write", "memory:share:read", "memory:share:write"],
      "team": "project-alpha",
      "managerId": "manager-project-alpha",
      "createdAt": 1706000000000
    }
  }
}
```

## CLI Commands Reference

### Team Management

```bash
# Create a team
cc-memory-cli team create --team-id <id> [--description <desc>]

# List all teams
cc-memory-cli team list

# Show team details
cc-memory-cli team show --team-id <id>
```

### Agent Management

```bash
# Add an agent
cc-memory-cli agent add --team-id <id> --client-id <id> [--level worker|observer|manager] [--manager-id <id>]

# Remove an agent
cc-memory-cli agent remove --client-id <id>

# List agents
cc-memory-cli agent list [--team-id <id>]
```

### API Key Management

```bash
# Regenerate API key
cc-memory-cli apikey regenerate --client-id <id>
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CC_MEMORY_PORT` | `3000` | HTTP server port |
| `CC_MEMORY_HOST` | `127.0.0.1` | HTTP server host |
| `CC_MEMORY_DATA_PATH` | `~/.claude-memory` | Data directory |
| `CC_MEMORY_AUTH_MODE` | `apikey` | Auth mode: `apikey` or `none` |
| `CC_MEMORY_API_KEYS_FILE` | `~/.claude-memory/api-keys.json` | API keys file path |
| `CC_MEMORY_WS_ENABLED` | `true` | Enable WebSocket sync |
| `CC_MEMORY_WS_PING_INTERVAL` | `30000` | WebSocket ping interval (ms) |
| `CC_MEMORY_WS_CONNECTION_TIMEOUT` | `60000` | WebSocket connection timeout (ms) |

## WebSocket Sync Protocol

### Authentication

Connect to `ws://host:port/sync` and send:

```json
{
  "type": "auth",
  "id": "msg-1",
  "timestamp": 1706000000000,
  "token": "ccm_your_api_key"
}
```

Response:

```json
{
  "type": "auth_response",
  "id": "msg-2",
  "timestamp": 1706000000000,
  "success": true,
  "clientId": "worker-001",
  "team": "project-alpha"
}
```

### Sync Events

```json
{
  "type": "sync_event",
  "id": "msg-3",
  "timestamp": 1706000000000,
  "event": {
    "id": "evt-1",
    "type": "create",
    "source": "worker-001",
    "target": "shared",
    "data": {
      "type": "working",
      "key": "task-status",
      "value": { "status": "in_progress" }
    },
    "vectorClock": { "worker-001": 1 }
  }
}
```

### Message Types

| Type | Description |
|------|-------------|
| `auth` | Authentication request |
| `auth_response` | Authentication result |
| `join_room` | Join a sync room |
| `leave_room` | Leave a sync room |
| `sync_event` | Single sync event |
| `sync_batch` | Batch of sync events |
| `sync_request` | Request sync from peer |
| `sync_response` | Response to sync request |
| `presence` | Online/offline status |
| `ping`/`pong` | Keep-alive |
| `error` | Error message |

## CRDT Conflict Resolution

When concurrent updates occur, cc-memory uses CRDTs (Conflict-free Replicated Data Types) with vector clocks:

### Resolution Strategies

| Strategy | When Used | Behavior |
|----------|-----------|----------|
| `merge_learnings` | Episodic memory | Union of learnings from both versions |
| `merge_observations` | Semantic entities | Union of observations |
| `newer_wins` | Simple values | Use vector clock to determine winner |
| `higher_importance` | Episodes | Keep version with higher importance |
| `higher_confidence` | Semantic | Keep version with higher confidence |

### Vector Clock Example

```
Agent A: { "A": 1 }  writes "value-A"
Agent B: { "B": 1 }  writes "value-B"

Conflict detected: neither clock dominates

Resolution (merge_learnings):
Result: { "A": 1, "B": 1 }, learnings merged from both
```

## Audit Logging

All cross-agent access is logged:

```json
{
  "id": "audit-123",
  "timestamp": 1706000000000,
  "actor": "manager-001",
  "action": "cross_agent_access",
  "resource": "worker-001:memory:task-status",
  "resourceType": "working_memory",
  "target": "worker-001",
  "result": "success"
}
```

### Query Audit Logs

```typescript
// Get agent activity
const logs = await auditLogger.getAgentActivity("manager-001", since);

// Query with filters
const logs = await auditLogger.query({
  actor: "manager-001",
  action: "read",
  result: "success",
  startTime: yesterday,
  endTime: now,
  limit: 100
});
```

## Migration from v1.0

Existing API keys are automatically migrated:

```bash
# Manual migration
npx ts-node src/scripts/migrate-api-keys.ts

# Or with specific paths
npx ts-node src/scripts/migrate-api-keys.ts input.json output.json
```

Migration behavior:
- All v1.0 keys become `worker` level
- Team is set to `null` (individual mode)
- Default scopes are applied
- Backup is created at `api-keys.v1.backup.json`

## Best Practices

### Security

1. **Use HTTPS** in production with `CC_MEMORY_REQUIRE_HTTPS=true`
2. **Rotate API keys** regularly with `apikey regenerate`
3. **Review audit logs** for unusual access patterns
4. **Limit manager permissions** to essential personnel

### Team Structure

1. **One manager per team** for clear ownership
2. **Use observers** for read-only access (dashboards, monitoring)
3. **Scope workers** to specific tasks

### Sync Configuration

1. **Adjust batch interval** based on update frequency
2. **Choose conflict strategy** based on data type:
   - `merge_learnings` for episodic (preserves all learnings)
   - `newer_wins` for simple state

### Performance

1. **Enable WebSocket** for real-time sync
2. **Use batching** for bulk operations
3. **Clean expired memories** with `memory_decay`

## Troubleshooting

### Common Issues

**Connection refused**
- Check server is running: `curl http://localhost:3000/health`
- Verify port and host configuration

**Authentication failed**
- Verify API key is correct
- Check key hasn't expired
- Ensure key hash matches

**Permission denied**
- Verify agent has required scopes
- Check team membership
- Confirm manager relationship

**Sync conflicts**
- Check vector clocks for causality
- Review conflict resolution strategy
- Inspect audit logs for concurrent writes

### Debug Mode

```bash
# Enable verbose logging
DEBUG=cc-memory:* npm run start:http
```

## Example: Multi-Agent Workflow

```
1. Manager creates shared task in shared pool
   └─ { key: "current-sprint", value: { tasks: [...] } }

2. Workers claim and update tasks
   ├─ Worker-001: Updates task-1 status
   └─ Worker-002: Updates task-2 status

3. Manager reviews all workers' private memories
   └─ Reads worker-001:working_memory, worker-002:working_memory

4. Observer monitors progress
   └─ Reads shared pool (read-only)

5. Sync propagates updates
   └─ All agents receive real-time updates via WebSocket
```

## API Reference

### Self-Service Registration Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/register` | POST | None | Register new agent with invite code |
| `/invite/:code` | GET | None | Validate invite code (public) |
| `/api/invites` | POST | Manager | Create new invite code |
| `/api/invites` | GET | Manager | List team's invite codes |
| `/api/invites/:code` | GET | Manager | Get invite details |
| `/api/invites/:code` | DELETE | Manager | Revoke invite code |

### Invite Code Options

When creating an invite code:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"worker"` | Permission level: `manager`, `worker`, or `observer` |
| `maxUses` | number | `null` | Max registrations (null = unlimited) |
| `expiresInHours` | number | `24` | Hours until expiration (null = never) |
| `description` | string | - | Optional note for tracking |

### Registration Request

```json
{
  "inviteCode": "inv_...",     // Required: The invite code
  "clientId": "my-agent-001",  // Required: Unique agent ID (3-64 chars, alphanumeric with - and _)
  "metadata": {}               // Optional: Custom metadata
}
```

See the main README.md for complete tool documentation.
