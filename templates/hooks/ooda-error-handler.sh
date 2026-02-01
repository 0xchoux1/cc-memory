#!/bin/bash
# CC-Memory OODA Error Handler Hook
# Triggered after tool execution to detect errors
# Suggests escalation when error threshold is reached

set -e

# Configuration
LOG_FILE="${CC_MEMORY_LOG:-/tmp/cc-memory-hook.log}"
ENABLE_ERROR_TRACKING="${CC_MEMORY_ENABLE_ERROR_TRACKING:-true}"
ERROR_THRESHOLD="${CC_MEMORY_ERROR_THRESHOLD:-3}"
ERROR_COUNTER_FILE="/tmp/cc-memory-error-counter"

# Skip if error tracking is disabled
if [ "$ENABLE_ERROR_TRACKING" = "false" ]; then
  echo '{}'
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty')
TOOL_ERROR=$(echo "$INPUT" | jq -r '.error // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

log() {
  echo "[$(date -Iseconds)] [OODA-Error] $1" >> "$LOG_FILE"
}

# Check for error indicators
HAS_ERROR=false
ERROR_CONTENT=""

if [ -n "$TOOL_ERROR" ] && [ "$TOOL_ERROR" != "null" ]; then
  HAS_ERROR=true
  ERROR_CONTENT="$TOOL_ERROR"
elif echo "$TOOL_OUTPUT" | grep -Eiq "error|exception|failed|fatal|panic|cannot|denied|not found|timeout|refused" 2>/dev/null; then
  # More specific error detection to avoid false positives
  if echo "$TOOL_OUTPUT" | grep -Eiq "Error:|Exception:|FATAL:|PANIC:|Permission denied|command not found|Connection refused|timed out" 2>/dev/null; then
    HAS_ERROR=true
    ERROR_CONTENT="$TOOL_OUTPUT"
  fi
fi

# Exit if no error
if [ "$HAS_ERROR" = "false" ]; then
  echo '{}'
  exit 0
fi

log "Error detected in tool: $TOOL_NAME"
log "Error content: $(echo "$ERROR_CONTENT" | head -c 200)"

# Get and increment error counter
ERROR_COUNT=0
if [ -f "$ERROR_COUNTER_FILE" ]; then
  ERROR_COUNT=$(cat "$ERROR_COUNTER_FILE" 2>/dev/null || echo "0")
fi
ERROR_COUNT=$((ERROR_COUNT + 1))
echo "$ERROR_COUNT" > "$ERROR_COUNTER_FILE"

log "Error count: $ERROR_COUNT (threshold: $ERROR_THRESHOLD)"

# Determine error severity
SEVERITY="low"
if echo "$ERROR_CONTENT" | grep -Eiq "fatal|panic|critical|cannot proceed|segfault|out of memory" 2>/dev/null; then
  SEVERITY="high"
elif echo "$ERROR_CONTENT" | grep -Eiq "permission denied|not found|timeout|connection refused" 2>/dev/null; then
  SEVERITY="medium"
fi

# Check if escalation is needed
NEEDS_ESCALATION=false
ESCALATION_REASON=""

if [ "$SEVERITY" = "high" ]; then
  NEEDS_ESCALATION=true
  ESCALATION_REASON="Critical error detected in $TOOL_NAME"
elif [ "$ERROR_COUNT" -ge "$ERROR_THRESHOLD" ]; then
  NEEDS_ESCALATION=true
  ESCALATION_REASON="Error threshold reached ($ERROR_COUNT errors in session)"
fi

# Build response
if [ "$NEEDS_ESCALATION" = "true" ]; then
  log "Triggering escalation suggestion: $ESCALATION_REASON"

  ERROR_SUMMARY=$(echo "$ERROR_CONTENT" | head -c 300 | tr '\n' ' ')

  # Output escalation suggestion
  jq -n \
    --arg reason "$ESCALATION_REASON" \
    --arg severity "$SEVERITY" \
    --arg tool "$TOOL_NAME" \
    --argjson count "$ERROR_COUNT" \
    --arg summary "$ERROR_SUMMARY" \
    '{
      "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "systemMessage": ("## OODA Escalation Suggested\n\n**Reason**: " + $reason + "\n**Severity**: " + $severity + "\n**Tool**: " + $tool + "\n**Error Count**: " + ($count | tostring) + "\n\n**Recent Error**:\n```\n" + $summary + "\n```\n\n### Recommended Actions\n\n1. Run `/escalate` to:\n   - Record this issue for future reference\n   - Get a structured analysis\n   - Explore resolution options\n\n2. Or use cc-memory to record manually:\n   ```\n   episode_record(type=\"error\", summary=\"...\", importance=7)\n   ```")
      }
    }'
else
  # Just log, don't output anything
  log "Error recorded but below escalation threshold"
  echo '{}'
fi
