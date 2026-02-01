#!/bin/bash
# CC-Memory Stop Hook: Save transcript automatically
# This script is called by Claude Code when a conversation ends

# Configuration
CC_MEMORY_CLI="${CC_MEMORY_CLI:-$(dirname "$0")/../../dist/cli/index.js}"
LOG_FILE="/tmp/cc-memory-hook.log"
SESSION_INFO_FILE="/tmp/cc-memory-session-info"

# Read JSON input from stdin (with timeout to avoid blocking)
INPUT=$(timeout 1 cat 2>/dev/null || echo "")

# Fallback 1: Read from session info file saved by ooda-session-end.sh
# (needed when stdin was consumed by a previous hook in the same Stop event)
if [ -z "$INPUT" ] || [ "$INPUT" = "" ]; then
    if [ -f "$SESSION_INFO_FILE" ]; then
        INPUT=$(cat "$SESSION_INFO_FILE" 2>/dev/null || echo "")
    fi
fi

# Try to parse from INPUT
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# Fallback 2: use Claude Code environment variables if available
# Claude Code hooks may provide these environment variables:
# - CLAUDE_SESSION_ID
# - CLAUDE_TRANSCRIPT_PATH
if [ -z "$SESSION_ID" ]; then
    SESSION_ID="${CLAUDE_SESSION_ID:-}"
fi
if [ -z "$TRANSCRIPT_PATH" ]; then
    TRANSCRIPT_PATH="${CLAUDE_TRANSCRIPT_PATH:-}"
fi

# Log the invocation
echo "[$(date -Iseconds)] Stop hook invoked (save-transcript)" >> "$LOG_FILE"
echo "  Session ID: $SESSION_ID" >> "$LOG_FILE"
echo "  Transcript: $TRANSCRIPT_PATH" >> "$LOG_FILE"
echo "  Input source: stdin=${#INPUT} bytes, file=${SESSION_INFO_FILE}" >> "$LOG_FILE"

# Validate inputs
if [ -z "$SESSION_ID" ] || [ -z "$TRANSCRIPT_PATH" ]; then
    echo "  Warning: Missing session_id or transcript_path" >> "$LOG_FILE"
    echo "  (stdin may have been consumed by previous hook, and session file was not found)" >> "$LOG_FILE"
    exit 0  # Exit cleanly to not block Claude
fi

if [ ! -f "$TRANSCRIPT_PATH" ]; then
    echo "  Error: Transcript file not found" >> "$LOG_FILE"
    exit 0
fi

if [ ! -f "$CC_MEMORY_CLI" ]; then
    echo "  Error: CLI tool not found at $CC_MEMORY_CLI" >> "$LOG_FILE"
    exit 0
fi

# Set API key for HTTP mode (optional)
export CC_MEMORY_API_KEY="${CC_MEMORY_API_KEY:-test-key-12345}"

# Run the CLI tool
node "$CC_MEMORY_CLI" save-transcript \
    --session-id "$SESSION_ID" \
    --transcript-path "$TRANSCRIPT_PATH" \
    >> "$LOG_FILE" 2>&1

echo "  Completed with exit code: $?" >> "$LOG_FILE"
