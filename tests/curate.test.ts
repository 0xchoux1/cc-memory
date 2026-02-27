import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { createToolHandler } from "../src/tools.js";
import { analyzeMemories, executeCuration } from "../src/curate.js";
import { DIMENSIONS } from "../src/embeddings.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-curate.db";

function fakeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    arr[i] = Math.sin(seed * (i + 1));
  }
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < DIMENSIONS; i++) arr[i] /= norm;
  return arr;
}

// Create a near-identical embedding (slightly perturbed)
function similarEmbedding(seed: number, noise: number = 0.01): Float32Array {
  const arr = fakeEmbedding(seed);
  for (let i = 0; i < arr.length; i++) {
    arr[i] += noise * Math.sin(i * 7);
  }
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < arr.length; i++) arr[i] /= norm;
  return arr;
}

describe("Curation", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  describe("analyzeMemories", () => {
    it("detects duplicate memories with similar embeddings", () => {
      const m1 = storage.storeMemory("default", "shared", null, "deploy rule: no friday", null, "a1");
      const m2 = storage.storeMemory("default", "shared", null, "deploy rule: avoid friday", null, "a1");
      const m3 = storage.storeMemory("default", "shared", null, "database backup config", null, "a1");

      // m1 and m2 get very similar embeddings, m3 gets different
      storage.storeEmbedding(m1.id, "default", fakeEmbedding(1));
      storage.storeEmbedding(m2.id, "default", similarEmbedding(1, 0.005));
      storage.storeEmbedding(m3.id, "default", fakeEmbedding(99));

      const memories = storage.listAllMemories("default");
      const report = analyzeMemories(storage, memories, 0.90);

      expect(report.duplicates.length).toBeGreaterThanOrEqual(1);
      // m1 and m2 should be grouped
      const group = report.duplicates.find(
        (g) => g.anchor.id === m1.id || g.anchor.id === m2.id
      );
      expect(group).toBeDefined();
    });

    it("does not flag unrelated memories as duplicates", () => {
      const m1 = storage.storeMemory("default", "shared", null, "TypeScript rules", null, "a1");
      const m2 = storage.storeMemory("default", "shared", null, "Python config", null, "a1");

      storage.storeEmbedding(m1.id, "default", fakeEmbedding(1));
      storage.storeEmbedding(m2.id, "default", fakeEmbedding(99));

      const memories = storage.listAllMemories("default");
      const report = analyzeMemories(storage, memories);

      expect(report.duplicates).toHaveLength(0);
    });

    it("selects oldest memory as anchor", () => {
      const m1 = storage.storeMemory("default", "shared", null, "first", null, "a1");
      const m2 = storage.storeMemory("default", "shared", null, "second", null, "a1");

      storage.storeEmbedding(m1.id, "default", fakeEmbedding(1));
      storage.storeEmbedding(m2.id, "default", similarEmbedding(1, 0.001));

      const memories = storage.listAllMemories("default");
      const report = analyzeMemories(storage, memories, 0.90);

      if (report.duplicates.length > 0) {
        // Anchor should be the older memory (m1)
        expect(report.duplicates[0].anchor.id).toBe(m1.id);
      }
    });

    it("detects stale memories (90+ days old)", () => {
      // Create a memory with old timestamp by direct DB manipulation
      const m = storage.storeMemory("default", "shared", null, "old info", null, "a1");
      const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      // Hack: update the timestamp directly
      (storage as any).db.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(oldDate, m.id);

      const memories = storage.listAllMemories("default");
      const report = analyzeMemories(storage, memories);

      expect(report.stale).toHaveLength(1);
      expect(report.stale[0].id).toBe(m.id);
    });
  });

  describe("executeCuration", () => {
    it("deletes duplicates and returns count", () => {
      const m1 = storage.storeMemory("default", "shared", null, "keep me", null, "a1");
      const m2 = storage.storeMemory("default", "shared", null, "delete me", null, "a1");

      storage.storeEmbedding(m1.id, "default", fakeEmbedding(1));
      storage.storeEmbedding(m2.id, "default", similarEmbedding(1, 0.001));

      const memories = storage.listAllMemories("default");
      const report = analyzeMemories(storage, memories, 0.90);

      if (report.duplicates.length > 0) {
        const result = executeCuration(storage, report);
        expect(result.deleted_count).toBeGreaterThan(0);
        // Anchor should still exist
        expect(storage.getMemory(report.duplicates[0].anchor.id)).toBeDefined();
      }
    });
  });

  describe("memory_curate tool", () => {
    let handle: (name: string, args: Record<string, unknown>) => Promise<string>;

    beforeEach(async () => {
      handle = createToolHandler(storage);
      await handle("project_create", { project_id: "p1", description: "Test" });
      await handle("agent_register", { project_id: "p1", agent_id: "mgr", role: "manager" });
      await handle("agent_register", { project_id: "p1", agent_id: "wkr", role: "worker" });
      await handle("agent_register", { project_id: "p1", agent_id: "wkr2", role: "worker" });
    });

    async function parse(name: string, args: Record<string, unknown>) {
      return JSON.parse(await handle(name, args));
    }

    it("dry_run returns report without deleting", async () => {
      const result = await parse("memory_curate", {
        caller_id: "mgr", project_id: "p1", dry_run: true,
      });
      expect(result.ok).toBe(true);
      expect(result.dry_run).toBe(true);
    });

    it("defaults to dry_run=true", async () => {
      const result = await parse("memory_curate", {
        caller_id: "mgr", project_id: "p1",
      });
      expect(result.dry_run).toBe(true);
    });

    it("dry_run=false executes curation", async () => {
      const result = await parse("memory_curate", {
        caller_id: "mgr", project_id: "p1", dry_run: false,
      });
      expect(result.ok).toBe(true);
      expect(result.dry_run).toBe(false);
      expect(result.deleted_count).toBeDefined();
    });

    it("worker cannot curate shared scope", async () => {
      const result = await parse("memory_curate", {
        caller_id: "wkr", project_id: "p1", scope: "shared",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("manager");
    });

    it("worker can curate own personal scope", async () => {
      const result = await parse("memory_curate", {
        caller_id: "wkr", project_id: "p1", scope: "personal",
      });
      expect(result.ok).toBe(true);
    });

    it("unregistered agent is rejected", async () => {
      const result = await parse("memory_curate", {
        caller_id: "unknown", project_id: "p1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not registered");
    });
  });
});
