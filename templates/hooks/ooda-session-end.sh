#!/bin/bash
# CC-Memory OODA Session End Hook
# Provides guidance for saving learnings at session end
# Actual memory operations are suggested for Claude to execute

set -e

# Configuration
LOG_FILE="${CC_MEMORY_LOG:-/tmp/cc-memory-hook.log}"
ENABLE_LEARNING="${CC_MEMORY_ENABLE_LEARNING:-true}"
ERROR_COUNTER_FILE="/tmp/cc-memory-error-counter"

# Skip if learning is disabled
if [ "$ENABLE_LEARNING" = "false" ]; then
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
STOP_REASON=$(echo "$INPUT" | jq -r '.stop_reason // "user"')

# Save session info for other hooks that run after this one
# (Since stdin is consumed, other hooks cannot read it)
SESSION_INFO_FILE="/tmp/cc-memory-session-info"
echo "$INPUT" > "$SESSION_INFO_FILE"

log() {
  echo "[$(date -Iseconds)] [OODA-End] $1" >> "$LOG_FILE"
}

log "Hook invoked - Session: $SESSION_ID, Reason: $STOP_REASON"

# Extract project name
PROJECT_NAME=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Get error count
ERROR_COUNT=0
if [ -f "$ERROR_COUNTER_FILE" ]; then
  ERROR_COUNT=$(cat "$ERROR_COUNTER_FILE" 2>/dev/null || echo "0")
  rm -f "$ERROR_COUNTER_FILE"  # Clean up for next session
fi

# Analyze transcript if available
MSG_COUNT=0
HAS_SUCCESS=false
HAS_ERRORS=false

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  MSG_COUNT=$(wc -l < "$TRANSCRIPT_PATH" 2>/dev/null || echo "0")

  if grep -q '"error"\|"failed"\|"exception"' "$TRANSCRIPT_PATH" 2>/dev/null; then
    HAS_ERRORS=true
  fi

  if grep -q '"success"\|"completed"\|"done"' "$TRANSCRIPT_PATH" 2>/dev/null; then
    HAS_SUCCESS=true
  fi
fi

# Determine outcome
OUTCOME="partial"
if [ "$HAS_SUCCESS" = "true" ] && [ "$HAS_ERRORS" = "false" ]; then
  OUTCOME="success"
elif [ "$HAS_ERRORS" = "true" ] && [ "$HAS_SUCCESS" = "false" ]; then
  OUTCOME="failure"
fi

log "Session summary: messages=$MSG_COUNT, errors=$ERROR_COUNT, outcome=$OUTCOME"

# Write session summary to log for debugging
cat >> "$LOG_FILE" << EOF
--- Session End Summary ---
Project: $PROJECT_NAME
Session: $SESSION_ID
Messages: $MSG_COUNT
Errors: $ERROR_COUNT
Outcome: $OUTCOME
Stop Reason: $STOP_REASON
Transcript: $TRANSCRIPT_PATH
---------------------------
EOF

# Output reminder for learning (only if significant session)
if [ "$MSG_COUNT" -ge 5 ]; then
  log "Session ended - learning opportunity detected"

  # Create a reminder message
  IMPORTANCE=5
  if [ "$OUTCOME" = "success" ]; then
    IMPORTANCE=6
  elif [ "$OUTCOME" = "failure" ]; then
    IMPORTANCE=7
  fi

  cat << EOF

## CC-Memory Session End

Session in **${PROJECT_NAME}** completed.

### Session Statistics
- Messages: ${MSG_COUNT}
- Errors: ${ERROR_COUNT}
- Outcome: ${OUTCOME}

### Recommended Actions

Before ending, consider saving learnings:

1. **Record Session as Episode**
   \`\`\`
   episode_record(
     type="interaction",
     summary="Session in ${PROJECT_NAME}: ${OUTCOME}",
     importance=${IMPORTANCE},
     tags=["session", "${PROJECT_NAME}", "${OUTCOME}"]
   )
   \`\`\`

2. **Save Important Decisions**
   If you made significant decisions, save them:
   \`\`\`
   semantic_create(type="fact", name="decision:...", description="...")
   \`\`\`

3. **Extract Patterns**
   If you noticed repeating patterns:
   \`\`\`
   pattern_create(pattern="...", confidence=0.7)
   \`\`\`

4. **Preserve OODA State**
   If work is incomplete:
   \`\`\`
   working_set(key="ooda_state", value={...}, ttl=86400000)
   \`\`\`

EOF
fi

exit 0
