---
name: cc-memory
description: "Scoped memory server for multi-agent development. Use when agents need to store/recall shared project knowledge or personal work logs across sessions. Provides shared scope (project-wide knowledge readable by all agents) and personal scope (agent-specific memories). Use for: (1) Storing shared project context (requirements, conventions, architecture), (2) Recording agent work logs, (3) Searching past memories by keyword, (4) Multi-agent coordination where agents need common ground."
---

# cc-memory Skill

Interact with cc-memory v2 — a scoped memory server for multi-agent development.

## Setup

Ensure cc-memory is installed and the CLI wrapper exists:

```bash
# Check if available
which cc-memory || ls ./bin/cc-mem.mjs
```

The database is stored at `~/.cc-memory/memory.db`.

## Usage

All commands use the CLI wrapper:

```bash
cd /home/exedev/.openclaw/workspace/cc-memory && node bin/cc-mem.mjs <tool> '<json_args>'
```

Shorthand in examples below: `cc-mem <tool> '<args>'`

## Core Concepts

**Scopes:**
- `shared` — Project-wide knowledge. All agents read, only managers write.
- `personal` — Agent-specific. Only the owner reads/writes (managers can read).

**Roles:**
- `manager` — Full access. Writes shared knowledge, reads all personal memories.
- `worker` — Reads shared, reads/writes own personal only.

## API Quick Reference

### Project & Agent Setup

```bash
# Create project
cc-mem project_create '{"project_id":"my-project","description":"My project"}'

# Register agents
cc-mem agent_register '{"project_id":"my-project","agent_id":"main-agent","role":"manager"}'
cc-mem agent_register '{"project_id":"my-project","agent_id":"sub-agent","role":"worker"}'
```

### Store Memory

```bash
# Manager stores shared knowledge
cc-mem memory_store '{"scope":"shared","agent_id":"main-agent","project_id":"my-project","content":"Use TypeScript strict mode","tags":["conventions"]}'

# Worker stores personal log
cc-mem memory_store '{"scope":"personal","agent_id":"sub-agent","project_id":"my-project","content":"Completed auth module","tags":["work-log"]}'
```

### Recall Memory

```bash
# Search shared knowledge
cc-mem memory_recall '{"scope":"shared","query":"conventions","caller_id":"sub-agent","project_id":"my-project"}'

# Search own personal memories
cc-mem memory_recall '{"scope":"personal","query":"auth","caller_id":"sub-agent","agent_id":"sub-agent","project_id":"my-project"}'

# Search everything accessible (shared + own personal)
cc-mem memory_recall '{"scope":"all","query":"auth","caller_id":"sub-agent","project_id":"my-project"}'
```

### Update & Delete

```bash
# Update (owner or manager only)
cc-mem memory_update '{"memory_id":"<id>","content":"Updated content","caller_id":"sub-agent","project_id":"my-project"}'

# Delete (owner or manager only)
cc-mem memory_delete '{"memory_id":"<id>","caller_id":"sub-agent","project_id":"my-project"}'
```

### List

```bash
cc-mem memory_list '{"scope":"shared","project_id":"my-project"}'
cc-mem project_list '{}'
cc-mem agent_list '{"project_id":"my-project"}'
```

## Multi-Agent Workflow Pattern

1. **Manager** creates project and registers agents
2. **Manager** stores shared knowledge (requirements, conventions, architecture)
3. **Workers** are spawned via `sessions_spawn`
4. **Workers** read shared knowledge → do their work → store personal logs
5. **Manager** reviews workers' personal logs for progress tracking

## Tips

- Use `tags` for categorization — makes recall more targeted
- `project_id` defaults to `"default"` if omitted
- All responses are JSON with `{"ok": true/false, ...}`
- `caller_id` is required for recall, update, and delete operations
