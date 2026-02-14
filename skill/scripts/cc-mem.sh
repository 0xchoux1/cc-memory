#!/bin/bash
# Convenience wrapper for cc-memory CLI
# Usage: cc-mem.sh <tool> '<json_args>'
CC_MEMORY_DIR="${CC_MEMORY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$CC_MEMORY_DIR" && node bin/cc-mem.mjs "$@"
