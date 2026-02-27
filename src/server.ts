#!/usr/bin/env node
// cc-memory v2 - MCP Server entry point
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Storage } from "./storage.js";
import { toolDefinitions, createToolHandler } from "./tools.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const DB_PATH = process.env.CC_MEMORY_DB ?? "cc-memory.db";

const storage = new Storage(DB_PATH);
const handleTool = createToolHandler(storage);

const server = new Server(
  { name: "cc-memory", version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleTool(name, args ?? {});
  return {
    content: [{ type: "text", text: result }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("cc-memory v2 MCP server started");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  storage.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  storage.close();
  process.exit(0);
});
