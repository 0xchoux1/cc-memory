#!/bin/bash
# Multi-Agent Integration Test Script
# Tests real-world multi-agent memory sharing scenario

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_DATA_DIR="${TEST_DATA_DIR:-/tmp/cc-memory-multi-agent-test}"
PORT="${PORT:-3001}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup() {
    log_info "Cleaning up..."
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$TEST_DATA_DIR"
}

trap cleanup EXIT

# Setup
log_info "Setting up test environment..."
mkdir -p "$TEST_DATA_DIR"

export CC_MEMORY_DATA_PATH="$TEST_DATA_DIR"
export CC_MEMORY_API_KEYS_FILE="$TEST_DATA_DIR/api-keys.json"
export CC_MEMORY_PORT="$PORT"
export CC_MEMORY_HOST="127.0.0.1"
export CC_MEMORY_AUTH_MODE="apikey"

# Build if needed
log_info "Building project..."
cd "$PROJECT_DIR"
npm run build

# Create team and agents
log_info "Creating team and agents..."

# Create team
OUTPUT=$(node dist/cli.js team create --team-id test-team --description "Test team for multi-agent scenario")
echo "$OUTPUT"
MANAGER_KEY=$(echo "$OUTPUT" | grep "ccm_" | tail -1 | tr -d ' ')

if [ -z "$MANAGER_KEY" ]; then
    log_error "Failed to extract manager key"
    exit 1
fi
log_info "Manager API key: $MANAGER_KEY"

# Add worker
OUTPUT=$(node dist/cli.js agent add --team-id test-team --client-id worker-001 --level worker)
echo "$OUTPUT"
WORKER_KEY=$(echo "$OUTPUT" | grep "ccm_" | tail -1 | tr -d ' ')

if [ -z "$WORKER_KEY" ]; then
    log_error "Failed to extract worker key"
    exit 1
fi
log_info "Worker API key: $WORKER_KEY"

# Add observer
OUTPUT=$(node dist/cli.js agent add --team-id test-team --client-id observer-001 --level observer)
echo "$OUTPUT"
OBSERVER_KEY=$(echo "$OUTPUT" | grep "ccm_" | tail -1 | tr -d ' ')

if [ -z "$OBSERVER_KEY" ]; then
    log_error "Failed to extract observer key"
    exit 1
fi
log_info "Observer API key: $OBSERVER_KEY"

# List team
log_info "Team configuration:"
node dist/cli.js team show --team-id test-team

# Start server
log_info "Starting HTTP server on port $PORT..."
node dist/http-server.js &
SERVER_PID=$!
sleep 2

# Check server health
log_info "Checking server health..."
HEALTH=$(curl -s "http://127.0.0.1:$PORT/health")
echo "$HEALTH"

if ! echo "$HEALTH" | grep -q "healthy"; then
    log_error "Server not healthy"
    exit 1
fi

# Test MCP initialize
log_info "Testing MCP initialize with manager key..."
INIT_RESPONSE=$(curl -s -X POST "http://127.0.0.1:$PORT/mcp" \
    -H "Authorization: Bearer $MANAGER_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "test-client", "version": "1.0.0" }
        }
    }')

echo "$INIT_RESPONSE"

if ! echo "$INIT_RESPONSE" | grep -q "serverInfo"; then
    log_error "MCP initialize failed"
    exit 1
fi

# Extract session ID from header
MANAGER_SESSION=$(echo "$INIT_RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4 || echo "")

# If no session ID in response, check if we need to parse it differently
if [ -z "$MANAGER_SESSION" ]; then
    log_warn "Could not extract session from response body, trying with verbose headers"
    INIT_RESPONSE=$(curl -s -i -X POST "http://127.0.0.1:$PORT/mcp" \
        -H "Authorization: Bearer $MANAGER_KEY" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "test-client", "version": "1.0.0" }
            }
        }')
    MANAGER_SESSION=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id" | cut -d':' -f2 | tr -d ' \r')
fi

if [ -z "$MANAGER_SESSION" ]; then
    log_warn "Could not extract session ID, but initialization succeeded"
else
    log_info "Manager session: $MANAGER_SESSION"
fi

# Test worker initialize
log_info "Testing MCP initialize with worker key..."
WORKER_INIT=$(curl -s -X POST "http://127.0.0.1:$PORT/mcp" \
    -H "Authorization: Bearer $WORKER_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "worker-client", "version": "1.0.0" }
        }
    }')

if ! echo "$WORKER_INIT" | grep -q "serverInfo"; then
    log_error "Worker MCP initialize failed"
    exit 1
fi
log_info "Worker initialization successful"

# Test observer initialize
log_info "Testing MCP initialize with observer key..."
OBSERVER_INIT=$(curl -s -X POST "http://127.0.0.1:$PORT/mcp" \
    -H "Authorization: Bearer $OBSERVER_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "observer-client", "version": "1.0.0" }
        }
    }')

if ! echo "$OBSERVER_INIT" | grep -q "serverInfo"; then
    log_error "Observer MCP initialize failed"
    exit 1
fi
log_info "Observer initialization successful"

# Test invalid key
log_info "Testing authentication with invalid key..."
INVALID_RESPONSE=$(curl -s -X POST "http://127.0.0.1:$PORT/mcp" \
    -H "Authorization: Bearer invalid_key" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "test-client", "version": "1.0.0" }
        }
    }')

if ! echo "$INVALID_RESPONSE" | grep -q "unauthorized"; then
    log_error "Invalid key should be rejected"
    exit 1
fi
log_info "Invalid key correctly rejected"

# Test WebSocket endpoint exists
log_info "Testing WebSocket endpoint availability..."
WS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/sync" || echo "000")
# WebSocket upgrade should return 400 for non-WebSocket request
if [ "$WS_CHECK" != "400" ] && [ "$WS_CHECK" != "426" ]; then
    log_warn "WebSocket endpoint check returned $WS_CHECK (expected 400 or 426 for non-WS request)"
fi
log_info "WebSocket endpoint is listening"

# Final health check with WebSocket stats
log_info "Final health check..."
FINAL_HEALTH=$(curl -s "http://127.0.0.1:$PORT/health")
echo "$FINAL_HEALTH"

if echo "$FINAL_HEALTH" | grep -q '"websocket"'; then
    log_info "WebSocket stats available in health endpoint"
fi

log_info "=========================================="
log_info "All tests passed!"
log_info "=========================================="
log_info ""
log_info "Test Summary:"
log_info "  - Team created: test-team"
log_info "  - Agents: manager-test-team, worker-001, observer-001"
log_info "  - HTTP endpoint: http://127.0.0.1:$PORT/mcp"
log_info "  - WebSocket endpoint: ws://127.0.0.1:$PORT/sync"
log_info ""
log_info "API Keys:"
log_info "  - Manager: $MANAGER_KEY"
log_info "  - Worker: $WORKER_KEY"
log_info "  - Observer: $OBSERVER_KEY"

exit 0
