#!/bin/bash
# CC-Memory HTTP Server Setup Script
# Run this on the machine that will host the cc-memory server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_FILE="$SCRIPT_DIR/cc-memory-http.service"
USER_SERVICE_DIR="$HOME/.config/systemd/user"

# Get local IP address
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo "=== CC-Memory HTTP Server Setup ==="
echo ""
echo "Repository: $REPO_DIR"
echo "Local IP: $LOCAL_IP"
echo ""

# Build if needed
if [ ! -d "$REPO_DIR/dist" ]; then
    echo "Building cc-memory..."
    cd "$REPO_DIR"
    npm install
    npm run build
fi

# Create systemd user directory
mkdir -p "$USER_SERVICE_DIR"

# Copy and customize service file
echo "Installing systemd service..."
sed -e "s|%h/src/github.com/0xchoux1/cc-memory|$REPO_DIR|g" \
    -e "s|CC_MEMORY_ALLOWED_HOSTS=127.0.0.1,localhost|CC_MEMORY_ALLOWED_HOSTS=127.0.0.1,localhost,$LOCAL_IP|g" \
    "$SERVICE_FILE" > "$USER_SERVICE_DIR/cc-memory-http.service"

# Check for nvm and update node path if needed
if [ -n "$NVM_DIR" ] && [ -f "$NVM_DIR/nvm.sh" ]; then
    NODE_PATH="$(which node)"
    sed -i "s|/usr/bin/env node|$NODE_PATH|g" "$USER_SERVICE_DIR/cc-memory-http.service"
fi

# Enable linger for user services to run after logout
echo "Enabling linger for user services..."
loginctl enable-linger "$USER" 2>/dev/null || true

# Reload and start service
echo "Starting cc-memory-http service..."
systemctl --user daemon-reload
systemctl --user enable cc-memory-http
systemctl --user restart cc-memory-http

# Wait and check status
sleep 2
if systemctl --user is-active --quiet cc-memory-http; then
    echo ""
    echo "=== Setup Complete ==="
    echo ""
    echo "Server running at: http://$LOCAL_IP:3000/mcp"
    echo ""
    echo "For other machines, add to ~/.claude/settings.json:"
    echo ""
    echo '{'
    echo '  "mcpServers": {'
    echo '    "cc-memory-remote": {'
    echo '      "type": "streamable-http",'
    echo "      \"url\": \"http://$LOCAL_IP:3000/mcp\","
    echo '      "headers": {'
    echo '        "Authorization": "Bearer YOUR_API_KEY"'
    echo '      }'
    echo '    }'
    echo '  }'
    echo '}'
    echo ""
    echo "To check status: systemctl --user status cc-memory-http"
    echo "To view logs: journalctl --user -u cc-memory-http -f"
else
    echo "Error: Service failed to start"
    systemctl --user status cc-memory-http
    exit 1
fi
