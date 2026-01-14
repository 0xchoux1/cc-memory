# CC-Memory Workflow Examples

This document shows practical workflows for using the cc-memory MCP server with Claude Code.

## 1. Task Tracking Workflow

Track complex multi-step tasks and their progress.

```
# Start a new task
working_set({
  key: "current-task",
  type: "task_state",
  value: {
    name: "Implement user authentication",
    steps: ["Design API", "Implement backend", "Create frontend", "Write tests"],
    currentStep: 0,
    startedAt: Date.now()
  },
  priority: "high",
  tags: ["auth", "feature"]
})

# Update progress
working_set({
  key: "current-task",
  type: "task_state",
  value: {
    name: "Implement user authentication",
    steps: ["Design API", "Implement backend", "Create frontend", "Write tests"],
    currentStep: 2,
    startedAt: 1234567890,
    notes: ["Completed backend with JWT tokens"]
  },
  priority: "high",
  tags: ["auth", "feature"]
})

# When task completes, consolidate to episodic memory
memory_consolidate({
  working_key: "current-task",
  target_type: "episodic",
  metadata: {
    episode_type: "success",
    summary: "Implemented user authentication with JWT",
    importance: 8
  }
})
```

## 2. Learning from Errors Workflow

Capture errors and learnings for future reference.

```
# Record an error when it happens
episode_record({
  type: "error",
  summary: "Database connection timeout",
  details: "The PostgreSQL connection timed out after 30 seconds during peak load",
  context: {
    projectPath: "/home/user/myapp",
    branch: "feature/user-search",
    files: ["src/db/connection.ts"]
  },
  importance: 7,
  tags: ["database", "performance", "postgres"]
})

# When you fix it, update with resolution
episode_update({
  id: "error-episode-id",
  outcome: {
    status: "success",
    learnings: [
      "Connection pool size was too small (default 10)",
      "Need to implement connection retry logic",
      "Consider adding connection health checks"
    ],
    resolution: "Increased pool size to 50 and added exponential backoff"
  }
})

# Extract learning as a reusable pattern
semantic_create({
  name: "postgres-connection-pattern",
  type: "pattern",
  description: "Best practices for PostgreSQL connection management",
  content: {
    poolSize: 50,
    retryStrategy: "exponential_backoff",
    healthCheckInterval: 30000
  },
  observations: [
    "Default pool size of 10 is too small for production",
    "Always implement retry logic for database connections"
  ],
  confidence: 0.9,
  tags: ["database", "postgres", "performance"]
})
```

## 3. Project Context Workflow

Maintain project context across sessions.

```
# Store project facts
semantic_create({
  name: "project-myapp-stack",
  type: "fact",
  description: "MyApp technology stack",
  content: {
    frontend: "React 18 with TypeScript",
    backend: "Node.js with Express",
    database: "PostgreSQL 15",
    cache: "Redis",
    deployment: "Docker on AWS ECS"
  },
  tags: ["myapp", "stack", "tech"]
})

# Store user preferences
semantic_create({
  name: "user-coding-style",
  type: "preference",
  description: "User's coding style preferences",
  content: {
    indentation: "2 spaces",
    quotes: "single",
    semicolons: false,
    lineLength: 100,
    preferArrowFunctions: true
  },
  observations: [
    "User always uses TypeScript for new files",
    "Prefers functional components over class components"
  ],
  tags: ["style", "preferences"]
})

# Store procedures
semantic_create({
  name: "myapp-deploy-procedure",
  type: "procedure",
  description: "How to deploy MyApp to production",
  procedure: {
    steps: [
      "Run npm test to ensure all tests pass",
      "Run npm run build to create production build",
      "Run docker build -t myapp:latest .",
      "Push to ECR: docker push ...",
      "Update ECS service: aws ecs update-service ...",
      "Verify health check: curl https://api.myapp.com/health"
    ],
    preconditions: [
      "All tests must pass",
      "Must be on main branch",
      "Version number must be bumped"
    ],
    postconditions: [
      "Health check returns 200",
      "No error logs in CloudWatch"
    ]
  },
  tags: ["deploy", "production", "myapp"]
})
```

## 4. Session Context Workflow

Maintain context during a coding session.

```
# At session start, recall relevant context
memory_recall({
  query: "myapp authentication",
  include_working: true,
  include_episodic: true,
  include_semantic: true,
  limit: 10
})

# Store session decisions
working_set({
  key: "session-decision-auth-method",
  type: "decision",
  value: {
    question: "Which authentication method to use?",
    options: ["JWT", "Session cookies", "OAuth2"],
    chosen: "JWT",
    reasoning: "Better for API-first architecture and mobile support"
  },
  tags: ["decision", "auth"]
})

# Track files being worked on
working_set({
  key: "current-files",
  type: "context",
  value: [
    "src/auth/jwt.ts",
    "src/middleware/authenticate.ts",
    "src/routes/auth.ts"
  ],
  tags: ["files", "auth"]
})
```

## 5. Knowledge Graph Workflow

Build relationships between concepts.

```
# Create related entities
semantic_create({
  name: "jwt-token",
  type: "fact",
  description: "JSON Web Token for authentication",
  tags: ["auth", "jwt", "token"]
})

semantic_create({
  name: "refresh-token",
  type: "fact",
  description: "Long-lived token for obtaining new access tokens",
  tags: ["auth", "jwt", "token"]
})

semantic_create({
  name: "access-token",
  type: "fact",
  description: "Short-lived token for API authentication",
  tags: ["auth", "jwt", "token"]
})

# Create relationships
semantic_relate({
  from: "access-token",
  to: "jwt-token",
  relation_type: "is_a",
  strength: 1.0
})

semantic_relate({
  from: "refresh-token",
  to: "access-token",
  relation_type: "generates",
  strength: 1.0
})

# Query the knowledge graph
# Use semantic_get to retrieve entity with relations
semantic_get({ identifier: "jwt-token" })
```

## 6. Export/Import Workflow

Backup and restore memory data.

```
# Export all memory data
memory_export({
  include_working: true,
  include_episodic: true,
  include_semantic: true
})

# Export only semantic knowledge (for sharing)
memory_export({
  include_working: false,
  include_episodic: false,
  include_semantic: true
})

# Import memory data (merge without overwriting)
memory_import({
  data: { /* exported data */ },
  overwrite: false,
  skip_working: true  # Don't import working memory from backup
})

# Import with overwrite (restore from backup)
memory_import({
  data: { /* exported data */ },
  overwrite: true
})
```

## 7. Milestone Tracking

Track project milestones and achievements.

```
# Record milestones
episode_record({
  type: "milestone",
  summary: "v1.0.0 released to production",
  details: "First stable release with core features: auth, user management, dashboard",
  outcome: {
    status: "success",
    learnings: [
      "Feature flags helped with gradual rollout",
      "E2E tests caught 3 bugs before release"
    ]
  },
  importance: 10,
  tags: ["release", "v1.0", "production"]
})

# Link related episodes
episode_relate({
  episode_id: "milestone-v1-id",
  related_id: "feature-auth-completed-id"
})

episode_relate({
  episode_id: "milestone-v1-id",
  related_id: "feature-dashboard-completed-id"
})

# Search past milestones
episode_search({
  type: "milestone",
  min_importance: 8,
  limit: 10
})
```

## Tips

1. **Use consistent tags** - Create a tagging taxonomy for your project
2. **Set appropriate importance** - 1-3 trivial, 4-6 normal, 7-9 important, 10 critical
3. **Consolidate regularly** - Move valuable working memory to episodic/semantic before TTL expiration
4. **Build knowledge incrementally** - Add observations to entities as you learn more
5. **Link related items** - Use relations and episode linking to build a connected memory graph
