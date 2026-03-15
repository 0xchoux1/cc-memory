#!/usr/bin/env node
// cc-memory v3 CLI - setup, doctor, status, migrate-embeddings
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { Storage } from "./storage.js";
import { embed } from "./embeddings.js";

const require = createRequire(import.meta.url);
const DB_PATH = process.env.CC_MEMORY_DB ?? "cc-memory.db";

function setup() {
  console.log("Setting up cc-memory v3...");
  const storage = new Storage(DB_PATH);
  console.log(`  sqlite-vec: ${storage.vectorEnabled ? "enabled ✅" : "not available ⚠️"}`);
  storage.close();
  console.log(`Database created at: ${resolve(DB_PATH)}`);
  console.log("Setup complete.");
}

function doctor() {
  console.log("cc-memory v3 doctor\n");

  // Check Node version
  const nodeVersion = process.version;
  console.log(`Node.js: ${nodeVersion} ✅`);

  // Check better-sqlite3
  try {
    require("better-sqlite3");
    console.log("better-sqlite3: installed ✅");
  } catch {
    console.log("better-sqlite3: missing ❌");
  }

  // Check sqlite-vec
  try {
    require("sqlite-vec");
    console.log("sqlite-vec: installed ✅");
  } catch {
    console.log("sqlite-vec: not installed ⚠️ (vector search disabled)");
  }

  // Check DB
  if (existsSync(resolve(DB_PATH))) {
    console.log(`Database: ${resolve(DB_PATH)} ✅`);
    try {
      const storage = new Storage(DB_PATH);
      const projects = storage.listProjects();
      console.log(`  Projects: ${projects.length}`);
      console.log(`  Vector search: ${storage.vectorEnabled ? "enabled" : "disabled"}`);
      storage.close();
    } catch (err) {
      console.log(`  Error reading DB: ${err}`);
    }
  } else {
    console.log(`Database: not found (run 'cc-memory setup')`);
  }
}

function status() {
  if (!existsSync(resolve(DB_PATH))) {
    console.log("No database found. Run 'cc-memory setup' first.");
    return;
  }

  const storage = new Storage(DB_PATH);
  const projects = storage.listProjects();

  console.log("cc-memory v3 status\n");
  console.log(`Database: ${resolve(DB_PATH)}`);
  console.log(`Vector search: ${storage.vectorEnabled ? "enabled" : "disabled"}`);
  console.log(`Projects: ${projects.length}`);

  for (const project of projects) {
    const agents = storage.listAgents(project.id);
    const shared = storage.listMemories("shared", project.id);
    const personal = storage.listMemories("personal", project.id);
    console.log(`\n  [${project.id}] ${project.description ?? ""}`);
    console.log(`    Agents: ${agents.length}`);
    console.log(`    Shared memories: ${shared.length}`);
    console.log(`    Personal memories: ${personal.length}`);
  }

  storage.close();
}

async function migrateEmbeddings() {
  if (!existsSync(resolve(DB_PATH))) {
    console.log("No database found. Run 'cc-memory setup' first.");
    return;
  }

  const storage = new Storage(DB_PATH);
  if (!storage.vectorEnabled) {
    console.log("sqlite-vec not available. Cannot migrate embeddings.");
    storage.close();
    return;
  }

  const memories = storage.listAllMemories();
  console.log(`Migrating embeddings for ${memories.length} memories...`);

  let success = 0;
  let skipped = 0;

  for (const memory of memories) {
    const vec = await embed(memory.content);
    if (vec) {
      storage.storeEmbedding(memory.id, memory.project_id, vec);
      success++;
      if (success % 10 === 0) {
        console.log(`  Progress: ${success}/${memories.length}`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nDone: ${success} embedded, ${skipped} skipped`);
  storage.close();
}

async function serve() {
  // Dynamic import to avoid loading MCP dependencies for CLI commands
  await import("./server.js");
}

// Main
const command = process.argv[2];
switch (command) {
  case "serve":
    serve();
    break;
  case "setup":
    setup();
    break;
  case "doctor":
    doctor();
    break;
  case "status":
    status();
    break;
  case "migrate-embeddings":
    migrateEmbeddings();
    break;
  default:
    console.log("cc-memory v3 CLI");
    console.log("Usage: cc-memory <command>");
    console.log("Commands: serve, setup, doctor, status, migrate-embeddings");
    process.exit(command ? 1 : 0);
}
