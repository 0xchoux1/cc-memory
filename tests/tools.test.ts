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
    // default + p1
    expect(list.count).toBeGreaterThanOrEqual(2);
  });

  it("default project exists", async () => {
    const list = await parse("project_list", {});
    expect(list.projects.some((p: any) => p.id === "default")).toBe(true);
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
    expect(stored.memory.created_by).toBe("mgr");

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

  // --- Auth checks for memory_recall ---
  describe("memory_recall auth", () => {
    beforeEach(async () => {
      await handle("project_create", { project_id: "p1", description: "Test" });
      await handle("agent_register", { project_id: "p1", agent_id: "mgr", role: "manager" });
      await handle("agent_register", { project_id: "p1", agent_id: "wkr", role: "worker" });
      await handle("agent_register", { project_id: "p1", agent_id: "wkr2", role: "worker" });
      // Store personal memories
      await handle("memory_store", { scope: "personal", agent_id: "wkr", content: "wkr secret", project_id: "p1" });
      await handle("memory_store", { scope: "personal", agent_id: "wkr2", content: "wkr2 secret", project_id: "p1" });
      await handle("memory_store", { scope: "shared", agent_id: "mgr", content: "shared info", project_id: "p1" });
    });

    it("worker can read own personal", async () => {
      const result = await parse("memory_recall", {
        scope: "personal", query: "secret", caller_id: "wkr", agent_id: "wkr", project_id: "p1",
      });
      expect(result.ok).toBe(true);
      expect(result.count).toBe(1);
    });

    it("worker cannot read other's personal", async () => {
      const result = await parse("memory_recall", {
        scope: "personal", query: "secret", caller_id: "wkr", agent_id: "wkr2", project_id: "p1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Workers");
    });

    it("manager can read other's personal", async () => {
      const result = await parse("memory_recall", {
        scope: "personal", query: "secret", caller_id: "mgr", agent_id: "wkr", project_id: "p1",
      });
      expect(result.ok).toBe(true);
      expect(result.count).toBe(1);
    });

    it("worker scope=all sees shared + own personal only", async () => {
      const result = await parse("memory_recall", {
        scope: "all", query: "secret info", caller_id: "wkr", project_id: "p1",
      });
      expect(result.ok).toBe(true);
      // Should see shared info + wkr secret, NOT wkr2 secret
      const contents = result.memories.map((m: any) => m.content);
      expect(contents).toContain("wkr secret");
      expect(contents).toContain("shared info");
      expect(contents).not.toContain("wkr2 secret");
    });

    it("manager scope=all sees everything", async () => {
      const result = await parse("memory_recall", {
        scope: "all", query: "secret info", caller_id: "mgr", project_id: "p1",
      });
      expect(result.ok).toBe(true);
      expect(result.count).toBe(3);
    });

    it("shared is readable by everyone", async () => {
      const result = await parse("memory_recall", {
        scope: "shared", query: "shared", caller_id: "wkr", project_id: "p1",
      });
      expect(result.ok).toBe(true);
      expect(result.count).toBe(1);
    });
  });

  // --- Auth checks for memory_delete ---
  describe("memory_delete auth", () => {
    beforeEach(async () => {
      await handle("project_create", { project_id: "p1", description: "Test" });
      await handle("agent_register", { project_id: "p1", agent_id: "mgr", role: "manager" });
      await handle("agent_register", { project_id: "p1", agent_id: "wkr", role: "worker" });
      await handle("agent_register", { project_id: "p1", agent_id: "wkr2", role: "worker" });
    });

    it("owner can delete own memory", async () => {
      const stored = await parse("memory_store", {
        scope: "personal", agent_id: "wkr", content: "my note", project_id: "p1",
      });
      const del = await parse("memory_delete", {
        memory_id: stored.memory.id, caller_id: "wkr", project_id: "p1",
      });
      expect(del.ok).toBe(true);
    });

    it("worker cannot delete other's memory", async () => {
      const stored = await parse("memory_store", {
        scope: "personal", agent_id: "wkr2", content: "not yours", project_id: "p1",
      });
      const del = await parse("memory_delete", {
        memory_id: stored.memory.id, caller_id: "wkr", project_id: "p1",
      });
      expect(del.ok).toBe(false);
      expect(del.error).toContain("owner");
    });

    it("manager can delete any memory", async () => {
      const stored = await parse("memory_store", {
        scope: "personal", agent_id: "wkr", content: "will be deleted", project_id: "p1",
      });
      const del = await parse("memory_delete", {
        memory_id: stored.memory.id, caller_id: "mgr", project_id: "p1",
      });
      expect(del.ok).toBe(true);
    });

    it("unregistered agent cannot delete", async () => {
      const stored = await parse("memory_store", {
        scope: "personal", agent_id: "wkr", content: "safe", project_id: "p1",
      });
      const del = await parse("memory_delete", {
        memory_id: stored.memory.id, caller_id: "unknown", project_id: "p1",
      });
      expect(del.ok).toBe(false);
      expect(del.error).toContain("not registered");
    });
  });
});
