---
name: observe
description: OODA Observe - Gather situational awareness and context
allowed-tools: Read, Grep, Glob, Bash(git:*), mcp__cc-memory__*
---

# OODA Observe Phase

Trigger the OODA Observe skill to gather comprehensive situational awareness.

## Instructions

Execute the observation process:

1. **Gather Codebase State**
   - Run `git status` to check repository state
   - Run `git diff --stat` to see changes
   - Identify current branch with `git branch --show-current`

2. **Detect Issues**
   - Check for compilation errors if applicable
   - Look for failing tests
   - Scan for runtime errors in logs

3. **Understand Task Context**
   - Review the user's request: $ARGUMENTS
   - Identify requirements and constraints
   - Note any blockers

4. **Query Memory**
   - Use `mcp__cc-memory__working_get` with key "ooda_state" for existing state
   - Use `mcp__cc-memory__episode_search` for related experiences
   - Use `mcp__cc-memory__semantic_search` for relevant facts

5. **Structure and Save Observations**
   Save to working memory using `mcp__cc-memory__working_set`:
   - key: "ooda_state"
   - type: "context"
   - priority: "high"
   - tags: ["ooda", "observe"]

## Output

Provide observation summary and confirm ready for /assess phase.

Use Japanese if user has been communicating in Japanese.
