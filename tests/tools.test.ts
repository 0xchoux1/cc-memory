import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { createToolHandler } from "../src/tools.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-tools.db";

describe("Tool Handler", () => {
  let storage: Storage;
  let handle: (name: string, args: Record<string, unknown>) => Promise<string>;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
    handle = createToolHandler(storage);
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  async function parse(name: string, args: Record<string, unknown>) {
    return JSON.parse(await handle(name, args));
  }

  it("project lifecycle", async () => {
    const created = await parse("project_create", { project_id: "p1", description: "Test" });
    expect(created.ok).toBe(true);

    const list = await parse("project_list", {});
    expect(list.count).toBe(1);
  });

  it("agent lifecycle", async () => {
    await handle("project_create", { project_id: "p1", description: "Test" });

    const reg = await parse("agent_register", { project_id: "p1", agent_id: "a1", role: "manager" });
    expect(reg.ok).toBe(true);

    const list = await parse("agent_list", { project_id: "p1" });
    expect(list.count).toBe(1);
  });

  it("memory store and recall", async () => {
    await handle("project_create", { project_id: "p1", description: "Test" });
    await handle("agent_register", { project_id: "p1", agent_id: "mgr", role: "manager" });

    const stored = await parse("memory_store", {
      scope: "shared", agent_id: "mgr", content: "Design doc v2", tags: ["design"], project_id: "p1",
    });
    expect(stored.ok).toBe(true);

    const recalled = await parse("memory_recall", {
      scope: "shared", query: "design", project_id: "p1",
    });
    expect(recalled.count).toBe(1);
  });

  it("blocks worker from storing shared", async () => {
    await handle("project_create", { project_id: "p1", description: "Test" });
    await handle("agent_register", { project_id: "p1", agent_id: "wkr", role: "worker" });

    const result = await parse("memory_store", {
      scope: "shared", agent_id: "wkr", content: "nope", project_id: "p1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("manager");
  });

  it("memory delete", async () => {
    await handle("project_create", { project_id: "p1", description: "Test" });
    await handle("agent_register", { project_id: "p1", agent_id: "mgr", role: "manager" });

    const stored = await parse("memory_store", {
      scope: "shared", agent_id: "mgr", content: "temp", project_id: "p1",
    });

    const del = await parse("memory_delete", { memory_id: stored.memory.id });
    expect(del.ok).toBe(true);
  });

  it("returns error for unknown tool", async () => {
    const result = await parse("nonexistent", {});
    expect(result.ok).toBe(false);
  });

  it("agent_register fails for missing project", async () => {
    const result = await parse("agent_register", { project_id: "nope", agent_id: "a1", role: "worker" });
    expect(result.ok).toBe(false);
  });
});
