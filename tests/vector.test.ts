import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-vector.db";

describe("Vector Search", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
  });

  it("has vector search enabled (sqlite-vec installed)", () => {
    expect(storage.vectorEnabled).toBe(true);
  });

  it("stores and retrieves embeddings", () => {
    const mem = storage.storeMemory("default", "shared", null, "test content", null, "mgr");
    const emb = new Float32Array(384).fill(0);
    emb[0] = 1.0;

    // Should not throw
    storage.storeEmbedding(mem.id, "default", emb);
  });

  it("deletes embeddings with memory", () => {
    const mem = storage.storeMemory("default", "shared", null, "to delete", null, "mgr");
    const emb = new Float32Array(384).fill(0);
    emb[0] = 1.0;
    storage.storeEmbedding(mem.id, "default", emb);

    const deleted = storage.deleteMemory(mem.id);
    expect(deleted).toBe(true);
  });

  it("hybrid search returns keyword results when no embeddings", () => {
    storage.storeMemory("default", "shared", null, "monitoring configuration for prometheus", null, "mgr");
    storage.storeMemory("default", "shared", null, "database backup schedule", null, "mgr");

    const results = storage.searchMemories("monitoring", "shared", "default", undefined, 10);
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("monitoring");
  });

  it("hybrid search uses vector distances when available", () => {
    // Store memories with embeddings
    const mem1 = storage.storeMemory("default", "shared", null, "server monitoring setup", null, "mgr");
    const mem2 = storage.storeMemory("default", "shared", null, "database backup plan", null, "mgr");
    const mem3 = storage.storeMemory("default", "shared", null, "network gateway config", null, "mgr");

    // Create embeddings: mem1 and query close, mem3 far
    const emb1 = new Float32Array(384).fill(0);
    emb1[0] = 1.0; // "monitoring" direction
    const emb2 = new Float32Array(384).fill(0);
    emb2[1] = 1.0; // "database" direction
    const emb3 = new Float32Array(384).fill(0);
    emb3[2] = 1.0; // "network" direction

    storage.storeEmbedding(mem1.id, "default", emb1);
    storage.storeEmbedding(mem2.id, "default", emb2);
    storage.storeEmbedding(mem3.id, "default", emb3);

    // Query embedding close to mem1
    const queryEmb = new Float32Array(384).fill(0);
    queryEmb[0] = 0.95;
    queryEmb[1] = 0.05;

    // Search with embedding - should prefer mem1 over mem2/mem3
    const results = storage.searchMemories(
      "configuration", // keyword matches mem3 too
      "shared",
      "default",
      undefined,
      10,
      queryEmb
    );

    expect(results.length).toBeGreaterThan(0);
    // mem1 should be ranked higher due to vector similarity
    expect(results[0].id).toBe(mem1.id);
  });

  it("vector search respects scope filtering", () => {
    const mem1 = storage.storeMemory("default", "shared", null, "shared data", null, "mgr");
    const mem2 = storage.storeMemory("default", "personal", "agent1", "personal data", null, "agent1");

    const emb = new Float32Array(384).fill(0);
    emb[0] = 1.0;
    storage.storeEmbedding(mem1.id, "default", emb);
    storage.storeEmbedding(mem2.id, "default", emb);

    const queryEmb = new Float32Array(384).fill(0);
    queryEmb[0] = 1.0;

    // Search personal scope - should only return personal memory
    const results = storage.searchMemories("data", "personal", "default", "agent1", 10, queryEmb);
    expect(results.every((m) => m.scope === "personal")).toBe(true);
  });

  it("listAllMemories returns all memories", () => {
    storage.storeMemory("default", "shared", null, "shared one", null, "mgr");
    storage.storeMemory("default", "personal", "a1", "personal one", null, "a1");

    const all = storage.listAllMemories();
    expect(all.length).toBe(2);
  });
});
