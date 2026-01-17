# CC-Memory

A hierarchical memory system for Claude Code, implemented as an MCP (Model Context Protocol) server.

## Overview

CC-Memory provides a three-layer memory architecture inspired by human cognitive systems:

- **Working Memory**: Short-term, TTL-based storage for current task context
- **Episodic Memory**: Long-term storage for events, incidents, and interactions
- **Semantic Memory**: Knowledge graph for facts, procedures, patterns, and skills

## Features

- SQLite-based persistence (using sql.js for portability)
- Full-text search across all memory layers
- Memory consolidation (working -> episodic/semantic)
- Cross-memory intelligent recall
- Session-based context management
- TTL-based automatic expiration
- Knowledge graph with entity relations
- **Built-in server instructions** - Claude automatically learns how to use cc-memory
- **Tachikoma Parallelization** - Sync memories between multiple Claude instances (inspired by Ghost in the Shell)
- **DIKW Wisdom Hierarchy** - Transform experiences into patterns, insights, and wisdom
- **Multi-Agent Collaboration** - Track which agent learned what

## Installation

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/0xchoux1/cc-memory.git
cd cc-memory

# Install dependencies
npm install

# Build
npm run build
```

### Configure Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "cc-memory": {
      "command": "node",
      "args": ["/path/to/cc-memory/dist/index.js"],
      "env": {
        "MEMORY_DATA_PATH": "/path/to/memory/data",
        "MEMORY_CLEANUP_INTERVAL": "300000"
      }
    }
  }
}
```

## Usage

### Working Memory

Short-term memory for current session context. Items expire based on their type.

```typescript
// Store a value
working_set({
  key: "current-task",
  value: { taskId: "123", description: "Implement feature" },
  type: "task_state",  // task_state, decision, context, scratch
  priority: "high",
  tags: ["feature", "important"]
});

// Retrieve a value
working_get({ key: "current-task" });

// List all items
working_list({ type: "task_state", tags: ["feature"] });

// Delete a value
working_delete({ key: "current-task" });

// Clear expired items
working_clear({ expired_only: true });
```

**Default TTLs by type:**
- `task_state`: 24 hours
- `decision`: 4 hours
- `context`: 1 hour
- `scratch`: 30 minutes

### Episodic Memory

Long-term memory for events and experiences.

```typescript
// Record an episode
episode_record({
  type: "success",  // incident, interaction, milestone, error, success
  summary: "Successfully deployed v1.0",
  details: "Deployed the application to production without issues",
  context: {
    projectPath: "/home/user/project",
    branch: "main",
    files: ["deploy.sh", "docker-compose.yml"]
  },
  outcome: {
    status: "success",
    learnings: ["Blue-green deployment worked well"],
    resolution: "Deployment completed in 5 minutes"
  },
  importance: 8,
  tags: ["deployment", "production"]
});

// Search episodes
episode_search({
  query: "deployment",
  type: "success",
  min_importance: 5,
  limit: 10
});

// Update episode with new learnings
episode_update({
  id: "episode-id",
  learnings: ["Additional learning discovered"],
  importance: 9
});

// Relate episodes
episode_relate({
  episode_id: "bug-found-id",
  related_id: "bug-fixed-id"
});
```

### Semantic Memory

Knowledge graph for facts, procedures, and patterns.

```typescript
// Create a fact
semantic_create({
  name: "project-language",
  type: "fact",  // procedure, fact, config, preference, pattern, skill
  description: "The project uses TypeScript",
  confidence: 1.0,
  tags: ["typescript", "language"]
});

// Create a procedure
semantic_create({
  name: "deploy-process",
  type: "procedure",
  description: "Production deployment procedure",
  procedure: {
    steps: [
      "Run tests",
      "Build Docker image",
      "Push to registry",
      "Deploy to cluster"
    ],
    preconditions: ["All tests pass", "Branch is main"],
    postconditions: ["Health check passes"]
  }
});

// Search entities
semantic_search({
  query: "typescript",
  type: "fact",
  min_confidence: 0.8
});

// Add observation
semantic_add_observation({
  identifier: "project-language",
  observation: "Also supports JavaScript for legacy code"
});

// Create relations
semantic_relate({
  from: "typescript",
  to: "javascript",
  relation_type: "extends",
  strength: 1.0
});
```

### Cross-Memory Operations

```typescript
// Consolidate working memory to episodic
memory_consolidate({
  working_key: "task-result",
  target_type: "episodic",
  metadata: {
    episode_type: "success",
    summary: "Task completed",
    importance: 7
  }
});

// Consolidate working memory to semantic
memory_consolidate({
  working_key: "learned-pattern",
  target_type: "semantic",
  metadata: {
    name: "error-handling-pattern",
    entity_type: "pattern",
    description: "Always wrap async calls in try-catch"
  }
});

// Intelligent recall across all layers
memory_recall({
  query: "authentication",
  include_working: true,
  include_episodic: true,
  include_semantic: true,
  limit: 10
});

// Get memory statistics
memory_stats();

// Export memory data
memory_export({
  include_working: true,
  include_episodic: true,
  include_semantic: true
});

// Import memory data
memory_import({
  data: exportedData,
  overwrite: false,
  skip_working: false
});
```

### Advanced Features

```typescript
// Smart recall with relevance scoring
smart_recall({
  query: "authentication",
  include_working: true,
  include_episodic: true,
  include_semantic: true,
  limit: 10,
  recency_weight: 0.3,      // Weight for recent items
  importance_weight: 0.4,   // Weight for important items
  confidence_weight: 0.3    // Weight for confident items
});

// Apply importance decay to old memories
memory_decay({
  decay_factor: 0.95,       // 5% decay per application
  min_importance: 1,        // Don't decay below 1
  older_than_days: 7        // Only decay memories older than 7 days
});

// Boost importance of frequently accessed memories
memory_boost({
  boost_factor: 1.1,        // 10% boost
  max_importance: 10,       // Cap at importance 10
  min_access_count: 5       // Must be accessed 5+ times
});
```

### Tachikoma Parallelization

Sync memories between multiple Claude instances, inspired by the Tachikoma from Ghost in the Shell.

#### Auto-Sync on Startup

Set the `CC_MEMORY_SYNC_DIR` environment variable to automatically import sync files when the server starts:

```json
{
  "mcpServers": {
    "cc-memory": {
      "command": "node",
      "args": ["/path/to/cc-memory/dist/index.js"],
      "env": {
        "CC_MEMORY_TACHIKOMA_NAME": "Tachikoma-Alpha",
        "CC_MEMORY_SYNC_DIR": "/shared/tachikoma-sync"
      }
    }
  }
}
```

**How it works:**
1. On startup, the server checks `CC_MEMORY_SYNC_DIR` for `.json` files
2. Valid Tachikoma export files are automatically imported
3. After successful import, files are renamed to `.imported.json` to prevent re-import
4. Files from the same Tachikoma ID are skipped

**Workflow for multi-instance sync:**
1. Instance A exports: `tachikoma_export({ output_path: "/shared/tachikoma-sync/alpha-export.json" })`
2. Instance B starts and auto-imports the file
3. Instance B exports: `tachikoma_export({ output_path: "/shared/tachikoma-sync/beta-export.json" })`
4. Instance A restarts and auto-imports B's memories

#### Manual Sync

```typescript
// Initialize this instance with a unique ID
tachikoma_init({
  id: "tachi-alpha",        // Optional: auto-generated if not provided
  name: "Tachikoma Alpha"   // Optional: human-readable name
});

// Check sync status
tachikoma_status();

// Export memories for sharing with other instances
tachikoma_export({
  since_timestamp: 1234567890  // Optional: only export changes since this time
});

// Import memories from another instance
tachikoma_import({
  data: exportedData,
  strategy: "merge_learnings",  // newer_wins, merge_learnings, merge_observations, manual
  auto_resolve: true
});

// View and resolve conflicts
tachikoma_conflicts({ unresolved_only: true });
tachikoma_resolve_conflict({
  conflict_id: "conflict-123",
  resolution: "local"  // local, remote, merge
});
```

**Conflict Resolution Strategies:**
- `newer_wins`: Use the more recently updated version
- `merge_learnings`: Merge learnings from both versions (for episodic memory)
- `merge_observations`: Merge observations from both versions (for semantic memory)
- `higher_importance`: Keep the version with higher importance
- `higher_confidence`: Keep the version with higher confidence
- `manual`: Create a conflict record for manual resolution

### DIKW Wisdom Hierarchy

Transform raw experiences into reusable knowledge through the Data → Information → Knowledge → Wisdom hierarchy.

```
Level 1: Raw Experience (Episodic Memory)
    ↓
Level 2: Patterns (Repeated observations)
    ↓
Level 3: Insights (Cross-domain understanding)
    ↓
Level 4: Wisdom (Universal principles)
```

#### Patterns (Level 2)

```typescript
// Create a pattern from observations
pattern_create({
  pattern: "Large API responses slow down UI rendering",
  supporting_episodes: ["ep-123", "ep-456"],
  related_tags: ["API", "performance"],
  confidence: 0.8
});

// Confirm a pattern after validation
pattern_confirm({
  pattern_id: "pattern-123",
  status: "confirmed"  // candidate, confirmed, rejected
});

// List patterns
pattern_list({
  status: "confirmed",
  min_confidence: 0.7,
  query: "API"
});
```

#### Insights (Level 3)

```typescript
// Generate insight from multiple patterns
insight_create({
  insight: "Unbounded data fetching causes issues on both frontend and backend",
  reasoning: "Pattern analysis shows correlation between large responses and failures",
  source_patterns: ["pattern-123", "pattern-456"],
  domains: ["API", "Performance", "UX"],
  confidence: 0.85
});

// Validate an insight
insight_validate({
  insight_id: "insight-123",
  status: "validated",  // candidate, validated, rejected
  validator: "architecture-agent"
});
```

#### Wisdom (Level 4)

```typescript
// Sublimate insights into wisdom
wisdom_create({
  name: "API Default Limits Principle",
  principle: "All collection APIs must have default pagination and limits",
  description: "Unbounded data fetching causes cascading failures across the stack",
  derived_from_insights: ["insight-123"],
  derived_from_patterns: ["pattern-123", "pattern-456"],
  applicable_domains: ["API Design", "REST", "GraphQL"],
  applicable_contexts: ["New API development", "API review"],
  limitations: ["Internal batch processing may need exceptions"],
  tags: ["API", "performance", "best-practice"]
});

// Search for applicable wisdom
wisdom_search({
  query: "API design",
  domains: ["REST"],
  min_confidence: 0.7
});

// Record wisdom application result
wisdom_apply({
  wisdom_id: "wisdom-123",
  context: "Designing new user list API",
  result: "success",  // success, failure, partial
  feedback: "Implemented pagination, prevented performance issues"
});
```

### Multi-Agent Collaboration

Track which agent (or persona) learned what, enabling specialized knowledge domains.

```typescript
// Register an agent
agent_register({
  name: "Frontend Specialist",
  role: "frontend",  // frontend, backend, security, testing, devops, architecture, data, general
  specializations: ["React", "TypeScript", "CSS"],
  capabilities: ["UI development", "Performance optimization"],
  knowledge_domains: ["Web Development", "UX"]
});

// Get agent info
agent_get({ id: "agent-123" });

// List agents by role
agent_list({ role: "frontend" });
```

## MCP Resources

Access memory data through MCP resources:

- `memory://working` - Current working memory items
- `memory://episodes/recent` - Recent 10 episodes
- `memory://semantic/graph` - Knowledge graph (entities + relations)
- `memory://stats` - Memory usage statistics

## MCP Prompts

Pre-built prompts for common operations:

### recall_context
Retrieve relevant memories for a task:
```
Prompt: recall_context
Parameters:
  - task_description: "Implementing user authentication"
  - include_episodes: true
  - include_semantic: true
```

### summarize_session
Generate session summary:
```
Prompt: summarize_session
Parameters:
  - session_id: "optional-session-id"
```

### extract_learnings
Extract knowledge from episodes:
```
Prompt: extract_learnings
Parameters:
  - episode_ids: ["id1", "id2"]
  - recent_count: 5
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DATA_PATH` | `~/.claude-memory` | Directory for database storage |
| `MEMORY_CLEANUP_INTERVAL` | `300000` (5 min) | Interval for expired item cleanup |
| `CC_MEMORY_TACHIKOMA_NAME` | - | Auto-initialize Tachikoma with this name on startup |
| `CC_MEMORY_SYNC_DIR` | - | Directory to auto-import sync files on startup |

## Server Instructions

cc-memory provides built-in instructions to Claude via MCP's `instructions` feature. When Claude connects to this server, it automatically receives guidance on:

- **Session startup**: Search for relevant memories and user preferences at the start of each session
- **When to save memories**: Guidelines for saving preferences, facts, episodes, and patterns
- **Importance levels**: How to assign appropriate importance (1-10) to memories
- **Auto-learning**: Claude is instructed to proactively save important information without explicit user requests

This means Claude will automatically use cc-memory effectively without requiring manual configuration in CLAUDE.md (though additional project-specific instructions can still be added there).

## Development

```bash
# Run in development mode with watch
npm run dev

# Run tests
npm test

# Run tests with watch
npm run test:watch

# Build
npm run build

# Clean build artifacts
npm run clean
```

## Architecture

```
cc-memory/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── memory/
│   │   ├── types.ts          # Type definitions (including DIKW & Tachikoma types)
│   │   ├── WorkingMemory.ts  # Working memory layer
│   │   ├── EpisodicMemory.ts # Episodic memory layer
│   │   ├── SemanticMemory.ts # Semantic memory layer
│   │   └── MemoryManager.ts  # Cross-layer orchestration
│   ├── server/
│   │   └── tools.ts          # MCP tool definitions (40+ tools)
│   └── storage/
│       └── SqliteStorage.ts  # SQLite persistence (including DIKW & Tachikoma tables)
├── tests/
│   ├── memory/               # Core memory unit tests
│   └── storage/              # DIKW & Tachikoma unit tests
├── scripts/
│   └── test-new-features.ts  # Functional test script
├── examples/
│   └── claude-code-config.json
└── dist/                     # Build output
```

### Database Schema

The SQLite database includes tables for:
- **Working Memory**: `working_memory`
- **Episodic Memory**: `episodic_memory`
- **Semantic Memory**: `semantic_entities`, `semantic_relations`
- **Agents**: `agents`
- **DIKW Hierarchy**: `patterns`, `insights`, `wisdom`, `wisdom_applications`
- **Tachikoma Sync**: `parallelization_meta`, `sync_history`, `conflicts`

## License

MIT
