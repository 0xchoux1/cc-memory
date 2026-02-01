---
name: OODA Observe
description: This skill should be used when the user asks to "observe", "check current state", "analyze codebase", "understand situation", "gather context", "what's the status", "scan for issues", or mentions OODA observe phase. Provides systematic observation and context gathering for autonomous decision-making loops.
version: 1.0.0
---

# OODA Observe - Situation Awareness Phase

This skill enables systematic observation and context gathering as the first phase of the OODA (Observe, Orient, Decide, Act) loop for autonomous agent operation.

## Purpose

Observe phase gathers comprehensive situational awareness:
- Current codebase state
- Active errors or issues
- Task context and requirements
- Environment status
- Relevant history from memory

## Observation Process

### Step 1: Gather Current Context

Collect information from multiple sources:

**Codebase State:**
- Run `git status` to check modified files
- Run `git diff --stat` to see change summary
- Identify active branch and recent commits

**Error Detection:**
- Check for TypeScript/compilation errors
- Look for test failures
- Scan logs for runtime errors

**Task Context:**
- Review user's current request
- Check for related open issues
- Identify dependencies and blockers

### Step 2: Query Memory for Context

Search cc-memory for relevant prior knowledge:

**Working Memory:**
Use `mcp__cc-memory__working_get` with key `ooda_state` to retrieve any existing observation state.

**Episodic Memory:**
Use `mcp__cc-memory__episode_search` with relevant tags to find past experiences with similar situations.

**Semantic Memory:**
Use `mcp__cc-memory__semantic_search` to find relevant facts, preferences, or patterns.

### Step 3: Structure Observations

Organize findings into structured observation data:

```json
{
  "timestamp": "ISO timestamp",
  "phase": "observe",
  "observations": {
    "codebase": {
      "branch": "current branch name",
      "modified_files": ["list of files"],
      "has_uncommitted": true/false
    },
    "errors": {
      "compilation": [],
      "tests": [],
      "runtime": []
    },
    "task": {
      "description": "current task summary",
      "requirements": [],
      "blockers": []
    },
    "environment": {
      "status": "healthy/degraded/error"
    }
  },
  "related_memory": {
    "episodes": [],
    "patterns": [],
    "facts": []
  }
}
```

### Step 4: Save to Working Memory

Store observation results for next OODA phases:

Use `mcp__cc-memory__working_set` with:
- `key`: "ooda_state"
- `value`: The structured observation data
- `type`: "context"
- `priority`: "high"
- `tags`: ["ooda", "observe", "context"]
- `ttl`: 3600000 (1 hour)

## Output Format

Provide a clear observation summary:

```
## Observation Summary

### Codebase State
- Branch: [branch name]
- Modified files: [count] files
- Status: [clean/dirty]

### Issues Detected
- Compilation errors: [count]
- Test failures: [count]
- Runtime errors: [count]

### Task Context
[Brief description of current task and requirements]

### Related Memory
- Found [N] relevant past experiences
- [N] applicable patterns identified

### Next Step
Ready for /assess phase to analyze observations.
```

## Integration with OODA Loop

This skill is Phase 1 of 4:
1. **Observe** (current) - Gather situational awareness
2. **Assess** (/assess) - Analyze and orient based on observations
3. **Plan** (/plan) - Decide on action strategy
4. **Execute** (/execute) - Implement the plan

## Multi-Agent Sharing

Observations are stored in cc-memory for sharing:
- Other agents can read `ooda_state` from working memory
- Shared context enables coordinated autonomous operation
- Use `mcp__cc-memory__shared_memory_set` for team-wide observations

## Error Handling

If observation fails:
- Log the failure in episode memory
- Set partial observation state
- Flag for /escalate if critical context missing

## Best Practices

1. **Be thorough:** Check all relevant sources
2. **Be structured:** Use consistent data format
3. **Be timely:** Include timestamps for freshness
4. **Be connected:** Query memory for context
5. **Be shareable:** Store in standard format for other agents
