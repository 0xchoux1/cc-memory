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
│   │   ├── types.ts          # Type definitions
│   │   ├── WorkingMemory.ts  # Working memory layer
│   │   ├── EpisodicMemory.ts # Episodic memory layer
│   │   ├── SemanticMemory.ts # Semantic memory layer
│   │   └── MemoryManager.ts  # Cross-layer orchestration
│   ├── server/
│   │   └── tools.ts          # MCP tool definitions
│   └── storage/
│       └── SqliteStorage.ts  # SQLite persistence
├── tests/
│   └── memory/               # Unit tests
├── examples/
│   └── claude-code-config.json
└── dist/                     # Build output
```

## License

MIT
