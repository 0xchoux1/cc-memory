#!/bin/bash
# CC-Memory OODA Session Start Hook
# Injects OODA context and instructions at session start
# Memory recall is done within Claude's session using MCP tools directly

set -e

# Configuration
LOG_FILE="${CC_MEMORY_LOG:-/tmp/cc-memory-hook.log}"
ENABLE_OODA="${CC_MEMORY_ENABLE_OODA:-true}"

# Skip if OODA is disabled
if [ "$ENABLE_OODA" = "false" ]; then
  echo '{}'
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

log() {
  echo "[$(date -Iseconds)] [OODA-Start] $1" >> "$LOG_FILE"
}

log "Hook invoked - Session: $SESSION_ID, CWD: $CWD"

# Extract project name from CWD
PROJECT_NAME=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Build context with OODA instructions
CONTEXT="## CC-Memory OODA Session Initialized

Project: ${PROJECT_NAME}
Session: ${SESSION_ID}
Working Directory: ${CWD}

### Memory Initialization

At the start of this session, please use cc-memory tools to recall relevant context:

1. **Recall Project Context**
   \`\`\`
   smart_recall(query=\"${PROJECT_NAME} recent work\", limit=5)
   \`\`\`

2. **Load User Preferences**
   \`\`\`
   semantic_search(type=\"preference\", limit=5)
   \`\`\`

3. **Check OODA State**
   \`\`\`
   working_get(key=\"ooda_state\")
   \`\`\`

4. **Review Recent Patterns**
   \`\`\`
   pattern_list(status=\"confirmed\", limit=3)
   \`\`\`

### OODA Commands Available

Use these commands for structured problem-solving:
- \`/observe\` - Gather situational awareness
- \`/assess\` - Analyze situation and generate options
- \`/plan\` - Create detailed action plan
- \`/execute\` - Execute plan with monitoring
- \`/escalate\` - Report blockers and request guidance

### Memory Commands Available

- \`/recall <query>\` - Search all memory layers
- \`/remember <info>\` - Save important information
- \`/reflect\` - Analyze patterns and insights
- \`/memory-status\` - Check memory statistics
"

log "Injecting OODA context for project: $PROJECT_NAME"

# Output JSON with context for Claude
jq -n --arg ctx "$CONTEXT" '{
  "continue": true,
  "suppressOutput": true,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
