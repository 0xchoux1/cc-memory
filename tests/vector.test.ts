import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { DIMENSIONS } from "../src/embeddings.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-vector.db";

function fakeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    arr[i] = Math.sin(seed * (i + 1));
  }
  // Normalize
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < DIMENSIONS; i++) arr[i] /= norm;
  return arr;
}

describe("Vector Search", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("vectorEnabled is true when sqlite-vec is available", () => {
    expect(storage.vectorEnabled).toBe(true);
  });

  it("stores and retrieves embeddings via KNN", () => {
    const m1 = storage.storeMemory("default", "shared", null, "apple banana", null, "a1");
    const m2 = storage.storeMemory("default", "shared", null, "cherry date", null, "a1");

    const emb1 = fakeEmbedding(1);
    const emb2 = fakeEmbedding(2);

    storage.storeEmbedding(m1.id, "default", emb1);
    storage.storeEmbedding(m2.id, "default", emb2);

    // Search with emb1 — should find m1 as closest
    const results = storage.vectorSearchPublic(m1.id, "default", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should be the memory itself (distance=0)
    expect(results[0].memory_id).toBe(m1.id);
    expect(results[0].distance).toBeCloseTo(0, 2);
  });

  it("deletes embeddings when memory is deleted", () => {
    const m = storage.storeMemory("default", "shared", null, "temp", null, "a1");
    storage.storeEmbedding(m.id, "default", fakeEmbedding(42));

    // Verify embedding exists via public search
    const before = storage.vectorSearchPublic(m.id, "default", 5);
    expect(before.length).toBeGreaterThanOrEqual(1);

    // Delete memory (should also delete embedding)
    storage.deleteMemory(m.id);

    // The embedding should be gone
    const after = storage.vectorSearchPublic(m.id, "default", 5);
    expect(after).toHaveLength(0);
  });

  it("keyword-only search still works without embeddings", () => {
    storage.storeMemory("default", "shared", null, "TypeScript is great", ["ts"], "a1");
    storage.storeMemory("default", "shared", null, "Python is cool", ["py"], "a1");

    const results = storage.searchMemories("TypeScript", "shared", "default");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("hybrid search uses vector + keyword", () => {
    const m1 = storage.storeMemory("default", "shared", null, "machine learning models", ["ml"], "a1");
    const m2 = storage.storeMemory("default", "shared", null, "web development", ["web"], "a1");
    const m3 = storage.storeMemory("default", "shared", null, "deep learning neural nets", ["ml"], "a1");

    // Give similar embeddings to m1 and m3 (both ML topics)
    const mlEmb = fakeEmbedding(10);
    const webEmb = fakeEmbedding(99);
    const mlEmb2 = fakeEmbedding(11); // close to mlEmb

    storage.storeEmbedding(m1.id, "default", mlEmb);
    storage.storeEmbedding(m2.id, "default", webEmb);
    storage.storeEmbedding(m3.id, "default", mlEmb2);

    // Hybrid search with ML-like query embedding
    const queryEmb = fakeEmbedding(10);
    const results = storage.searchMemories("learning", "shared", "default", undefined, 10, queryEmb);

    // Should find ML-related memories (m1 and m3), not web (m2)
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(m1.id);
  });

  it("scope filtering works in hybrid search", () => {
    const m1 = storage.storeMemory("default", "shared", null, "shared fact", null, "a1");
    const m2 = storage.storeMemory("default", "personal", "a1", "personal fact", null, "a1");

    storage.storeEmbedding(m1.id, "default", fakeEmbedding(1));
    storage.storeEmbedding(m2.id, "default", fakeEmbedding(2));

    // Search shared scope only
    const results = storage.searchMemories("fact", "shared", "default", undefined, 10, fakeEmbedding(1));
    const scopes = results.map((r) => r.scope);
    expect(scopes.every((s) => s === "shared")).toBe(true);
  });

  it("listAllMemories returns all scopes", () => {
    storage.storeMemory("default", "shared", null, "shared", null, "a1");
    storage.storeMemory("default", "personal", "a1", "personal", null, "a1");

    const all = storage.listAllMemories("default");
    expect(all).toHaveLength(2);
  });
});
