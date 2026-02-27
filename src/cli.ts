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
  console.log("Setting up cc-memory...");
  const storage = new Storage(DB_PATH);
  console.log(`Database created at: ${resolve(DB_PATH)}`);
  console.log(`Vector search: ${storage.vectorEnabled ? "enabled" : "disabled (sqlite-vec not found)"}`);
  storage.close();
  console.log("Setup complete.");
}

function doctor() {
  console.log("cc-memory doctor\n");

  const nodeVersion = process.version;
  console.log(`Node.js: ${nodeVersion}`);

  try {
    require("better-sqlite3");
    console.log("better-sqlite3: installed");
  } catch {
    console.log("better-sqlite3: missing");
  }

  try {
    require("sqlite-vec");
    console.log("sqlite-vec: installed");
  } catch {
    console.log("sqlite-vec: not installed (vector search disabled)");
  }

  if (existsSync(resolve(DB_PATH))) {
    console.log(`Database: ${resolve(DB_PATH)}`);
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

  console.log("cc-memory status\n");
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
    console.error("No database found. Run 'cc-memory setup' first.");
    process.exit(1);
  }

  const storage = new Storage(DB_PATH);
  if (!storage.vectorEnabled) {
    console.error("sqlite-vec not available. Install sqlite-vec first.");
    storage.close();
    process.exit(1);
  }

  const memories = storage.listAllMemories();
  console.log(`Migrating embeddings for ${memories.length} memories...`);

  let success = 0;
  let failed = 0;
  for (const mem of memories) {
    const text = mem.content + " " + (mem.tags?.join(" ") ?? "");
    const emb = await embed(text);
    if (emb) {
      storage.storeEmbedding(mem.id, mem.project_id, emb);
      success++;
    } else {
      failed++;
    }
    if ((success + failed) % 10 === 0) {
      process.stdout.write(`\r  ${success + failed}/${memories.length}`);
    }
  }

  console.log(`\nMigrated: ${success} success, ${failed} failed, ${memories.length} total`);
  storage.close();
}

// Main
const command = process.argv[2];
switch (command) {
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
    await migrateEmbeddings();
    break;
  default:
    console.log("cc-memory CLI");
    console.log("Usage: cc-memory <command>");
    console.log("Commands: setup, doctor, status, migrate-embeddings");
    process.exit(command ? 1 : 0);
}
