#!/usr/bin/env node
// cc-memory v2 CLI - setup, doctor, status
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Storage } from "./storage.js";

const DB_PATH = process.env.CC_MEMORY_DB ?? "cc-memory.db";

function setup() {
  console.log("Setting up cc-memory v2...");
  const storage = new Storage(DB_PATH);
  storage.close();
  console.log(`Database created at: ${resolve(DB_PATH)}`);
  console.log("Setup complete.");
}

function doctor() {
  console.log("cc-memory v2 doctor\n");

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

  // Check DB
  if (existsSync(resolve(DB_PATH))) {
    console.log(`Database: ${resolve(DB_PATH)} ✅`);
    try {
      const storage = new Storage(DB_PATH);
      const projects = storage.listProjects();
      console.log(`  Projects: ${projects.length}`);
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

  console.log("cc-memory v2 status\n");
  console.log(`Database: ${resolve(DB_PATH)}`);
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
  default:
    console.log("cc-memory v2 CLI");
    console.log("Usage: cc-memory <command>");
    console.log("Commands: setup, doctor, status");
    process.exit(command ? 1 : 0);
}
