#!/bin/bash
# CC-Memory Client Setup Script
# Run this on machines that will connect to the cc-memory server

set -e

CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "=== CC-Memory Client Setup ==="
echo ""

# Get server address
read -p "Enter cc-memory server address (e.g., 192.168.50.209): " SERVER_IP
read -p "Enter port (default: 3000): " SERVER_PORT
SERVER_PORT=${SERVER_PORT:-3000}

read -p "Enter API key: " API_KEY

SERVER_URL="http://$SERVER_IP:$SERVER_PORT/mcp"

echo ""
echo "Testing connection to $SERVER_URL..."

# Test connection
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$SERVER_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"ping","id":1}' 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
    echo "Error: Cannot connect to server. Check if the server is running."
    exit 1
fi

echo "Connection successful (HTTP $HTTP_CODE)"
echo ""

# Create Claude settings directory
mkdir -p "$(dirname "$CLAUDE_SETTINGS")"

# Check if settings file exists
if [ -f "$CLAUDE_SETTINGS" ]; then
    echo "Existing settings found. Backing up to ${CLAUDE_SETTINGS}.bak"
    cp "$CLAUDE_SETTINGS" "${CLAUDE_SETTINGS}.bak"

    # Check if jq is available for merging
    if command -v jq &> /dev/null; then
        echo "Merging with existing settings..."
        jq --arg url "$SERVER_URL" --arg key "$API_KEY" '
            .mcpServers["cc-memory-remote"] = {
                "type": "streamable-http",
                "url": $url,
                "headers": {
                    "Authorization": ("Bearer " + $key)
                }
            }
        ' "$CLAUDE_SETTINGS" > "${CLAUDE_SETTINGS}.tmp" && mv "${CLAUDE_SETTINGS}.tmp" "$CLAUDE_SETTINGS"
    else
        echo "Warning: jq not installed. Please manually merge the settings."
        echo ""
        echo "Add this to your $CLAUDE_SETTINGS:"
    fi
else
    # Create new settings file
    cat > "$CLAUDE_SETTINGS" << EOF
{
  "mcpServers": {
    "cc-memory-remote": {
      "type": "streamable-http",
      "url": "$SERVER_URL",
      "headers": {
        "Authorization": "Bearer $API_KEY"
      }
    }
  }
}
EOF
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Settings saved to: $CLAUDE_SETTINGS"
echo ""
cat "$CLAUDE_SETTINGS"
echo ""
echo "Restart Claude Code to apply changes."
