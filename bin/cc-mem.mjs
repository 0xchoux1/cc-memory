#!/usr/bin/env node
// cc-mem - CLI wrapper for cc-memory v2
// Usage: cc-mem <command> [args as JSON]

import { Storage } from '../dist/storage.js';
import { createToolHandler } from '../dist/tools.js';

const DB_PATH = process.env.CC_MEMORY_DB || `${process.env.HOME}/.cc-memory/memory.db`;

// Ensure directory exists
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
mkdirSync(dirname(DB_PATH), { recursive: true });

const storage = new Storage(DB_PATH);
const handle = createToolHandler(storage);

const command = process.argv[2];
const argsJson = process.argv[3] || '{}';

if (!command) {
  console.error('Usage: cc-mem <tool_name> \'{"param": "value"}\'');
  console.error('Tools: memory_store, memory_recall, memory_list, memory_delete, project_create, project_list, agent_register, agent_list');
  process.exit(1);
}

try {
  const args = JSON.parse(argsJson);
  const result = await handle(command, args);
  console.log(result);
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
} finally {
  storage.close();
}
