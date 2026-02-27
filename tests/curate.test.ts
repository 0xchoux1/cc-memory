import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { createToolHandler, schemas } from "../src/tools.js";
import { analyzeMemories, executeCuration } from "../src/curate.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-curate.db";

describe("Curation", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
    storage.createProject("p1", "test");
    storage.registerAgent("p1", "mgr", "manager");
    storage.registerAgent("p1", "wkr", "worker");
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
  });

  function storeWithEmbedding(content: string, scope: "shared" | "personal", agentId: string | null, embedding: Float32Array) {
    const mem = storage.storeMemory("p1", scope, agentId, content, null, agentId ?? "mgr");
    storage.storeEmbedding(mem.id, "p1", embedding);
    return mem;
  }

  it("detects duplicates (similar embeddings)", () => {
    // Two very similar embeddings
    const emb1 = new Float32Array(384).fill(0);
    emb1[0] = 1.0;
    const emb2 = new Float32Array(384).fill(0);
    emb2[0] = 0.99;
    emb2[1] = 0.01;
    // One different embedding
    const emb3 = new Float32Array(384).fill(0);
    emb3[1] = 1.0;

    storeWithEmbedding("monitoring config for prometheus", "shared", null, emb1);
    storeWithEmbedding("monitoring configuration prometheus", "shared", null, emb2);
    storeWithEmbedding("database backup schedule", "shared", null, emb3);

    const memories = storage.listMemories("shared", "p1");
    const report = analyzeMemories(storage, memories, 0.85);

    expect(report.total_memories).toBe(3);
    expect(report.duplicate_groups.length).toBe(1);
    expect(report.duplicate_groups[0].duplicates.length).toBe(1);
  });

  it("does not flag dissimilar memories as duplicates", () => {
    const emb1 = new Float32Array(384).fill(0);
    emb1[0] = 1.0;
    const emb2 = new Float32Array(384).fill(0);
    emb2[1] = 1.0;

    storeWithEmbedding("monitoring config", "shared", null, emb1);
    storeWithEmbedding("database backup", "shared", null, emb2);

    const memories = storage.listMemories("shared", "p1");
    const report = analyzeMemories(storage, memories, 0.85);

    expect(report.duplicate_groups.length).toBe(0);
  });

  it("keeps oldest memory as anchor", () => {
    const emb = new Float32Array(384).fill(0);
    emb[0] = 1.0;
    const embClose = new Float32Array(384).fill(0);
    embClose[0] = 0.999;

    const older = storeWithEmbedding("first version", "shared", null, emb);
    storeWithEmbedding("second version (dupe)", "shared", null, embClose);

    const memories = storage.listMemories("shared", "p1");
    const report = analyzeMemories(storage, memories, 0.85);

    expect(report.duplicate_groups.length).toBe(1);
    expect(report.duplicate_groups[0].anchor.id).toBe(older.id);
  });

  it("executeCuration deletes duplicates", () => {
    const emb = new Float32Array(384).fill(0);
    emb[0] = 1.0;
    const embClose = new Float32Array(384).fill(0);
    embClose[0] = 0.999;

    storeWithEmbedding("original", "shared", null, emb);
    const dupe = storeWithEmbedding("duplicate of original", "shared", null, embClose);

    const memories = storage.listMemories("shared", "p1");
    const report = analyzeMemories(storage, memories, 0.85);
    const result = executeCuration(storage, report);

    expect(result.actions_taken.some((a) => a.action === "deleted_duplicate" && a.memory_id === dupe.id)).toBe(true);

    // Verify actually deleted
    expect(storage.getMemory(dupe.id)).toBeUndefined();
  });

  it("detects stale memories (>90 days old)", () => {
    const emb = new Float32Array(384).fill(0);
    emb[0] = 1.0;

    // Manually insert a stale memory with old updated_at
    const mem = storage.storeMemory("p1", "shared", null, "ancient config", null, "mgr");
    storage.storeEmbedding(mem.id, "p1", emb);

    // Hack updated_at to 100 days ago
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    (storage as any).db.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(oldDate, mem.id);

    const memories = storage.listMemories("shared", "p1");
    // Re-fetch to get updated timestamp
    const freshMemories = memories.map((m) => storage.getMemory(m.id)!);
    const report = analyzeMemories(storage, freshMemories, 0.85);

    expect(report.stale_memories.length).toBe(1);
    expect(report.stale_memories[0].id).toBe(mem.id);
  });

  // Tool handler integration tests
  describe("memory_curate tool", () => {
    let handle: (name: string, args: Record<string, unknown>) => Promise<string>;
    const parse = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(await handle(name, args));

    beforeEach(() => {
      handle = createToolHandler(storage);
    });

    it("dry_run returns report without deleting", async () => {
      const emb = new Float32Array(384).fill(0);
      emb[0] = 1.0;
      const embClose = new Float32Array(384).fill(0);
      embClose[0] = 0.999;

      storeWithEmbedding("config A", "shared", null, emb);
      storeWithEmbedding("config A copy", "shared", null, embClose);

      const result = await parse("memory_curate", {
        caller_id: "mgr",
        scope: "shared",
        project_id: "p1",
        dry_run: true,
      });

      expect(result.ok).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.duplicates_found).toBeGreaterThan(0);

      // Verify nothing was deleted
      const all = storage.listMemories("shared", "p1");
      expect(all.length).toBe(2);
    });

    it("dry_run=false deletes duplicates", async () => {
      const emb = new Float32Array(384).fill(0);
      emb[0] = 1.0;
      const embClose = new Float32Array(384).fill(0);
      embClose[0] = 0.999;

      storeWithEmbedding("original", "shared", null, emb);
      storeWithEmbedding("near-duplicate", "shared", null, embClose);

      const result = await parse("memory_curate", {
        caller_id: "mgr",
        scope: "shared",
        project_id: "p1",
        dry_run: false,
      });

      expect(result.ok).toBe(true);
      expect(result.dry_run).toBe(false);
      expect(result.duplicates_deleted).toBe(1);

      const remaining = storage.listMemories("shared", "p1");
      expect(remaining.length).toBe(1);
    });

    it("blocks worker from curating shared scope", async () => {
      const result = await parse("memory_curate", {
        caller_id: "wkr",
        scope: "shared",
        project_id: "p1",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("manager");
    });

    it("allows worker to curate own personal scope", async () => {
      const emb = new Float32Array(384).fill(0);
      emb[0] = 1.0;
      storeWithEmbedding("my note", "personal", "wkr", emb);

      const result = await parse("memory_curate", {
        caller_id: "wkr",
        scope: "personal",
        project_id: "p1",
      });

      expect(result.ok).toBe(true);
    });

    it("blocks worker from curating another agent's personal scope", async () => {
      storage.registerAgent("p1", "other", "worker");

      const result = await parse("memory_curate", {
        caller_id: "wkr",
        scope: "personal",
        agent_id: "other",
        project_id: "p1",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("own personal");
    });
  });
});
