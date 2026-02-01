#!/bin/bash
# cc-memory Demo Script for asciinema
# Usage: asciinema rec demo.cast --command "bash demo-script.sh"

# Clear screen for clean start
clear

echo "=== cc-memory Demo ==="
echo ""
sleep 1

# Show help
echo "$ cc-memory help"
sleep 0.5
cc-memory help
sleep 2

echo ""
echo "$ cc-memory setup --dry-run"
sleep 0.5
cc-memory setup --dry-run
sleep 2

echo ""
echo "$ cc-memory doctor"
sleep 0.5
cc-memory doctor
sleep 2

echo ""
echo "$ cc-memory status"
sleep 0.5
cc-memory status
sleep 1

echo ""
echo "=== Demo Complete ==="
