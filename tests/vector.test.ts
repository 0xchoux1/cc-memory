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

  it("stores embeddings and finds via hybrid search", () => {
    const m1 = storage.storeMemory("default", "shared", null, "apple banana", null, "a1");
    const m2 = storage.storeMemory("default", "shared", null, "cherry date", null, "a1");

    const emb1 = fakeEmbedding(1);
    const emb2 = fakeEmbedding(2);

    storage.storeEmbedding(m1.id, "default", emb1);
    storage.storeEmbedding(m2.id, "default", emb2);

    // Hybrid search with emb1 as query — should rank m1 higher
    const results = storage.searchMemories("apple", "shared", "default", undefined, 10, emb1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(m1.id);
  });

  it("deletes embeddings when memory is deleted", () => {
    const m1 = storage.storeMemory("default", "shared", null, "fruit apple", null, "a1");
    const m2 = storage.storeMemory("default", "shared", null, "fruit banana", null, "a1");
    const emb = fakeEmbedding(42);
    storage.storeEmbedding(m1.id, "default", emb);
    storage.storeEmbedding(m2.id, "default", fakeEmbedding(43));

    // Delete memory (should also delete embedding)
    storage.deleteMemory(m1.id);

    // Hybrid search should not find deleted memory
    const results = storage.searchMemories("fruit", "shared", "default", undefined, 10, emb);
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain(m1.id);
  });

  it("deletes embeddings when memory content is updated", () => {
    const m = storage.storeMemory("default", "shared", null, "original content", null, "a1");
    storage.storeEmbedding(m.id, "default", fakeEmbedding(1));

    // Update content — old embedding should be deleted
    storage.updateMemory(m.id, "completely new content", "a1");

    // Hybrid search with old embedding should not find a vector match
    // (keyword match may still work, but the old vector is gone)
    const results = storage.searchMemories("original", "shared", "default", undefined, 10, fakeEmbedding(1));
    // "original" is no longer in content, so shouldn't match
    expect(results).toHaveLength(0);
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

    const mlEmb = fakeEmbedding(10);
    const webEmb = fakeEmbedding(99);
    const mlEmb2 = fakeEmbedding(11); // close to mlEmb

    storage.storeEmbedding(m1.id, "default", mlEmb);
    storage.storeEmbedding(m2.id, "default", webEmb);
    storage.storeEmbedding(m3.id, "default", mlEmb2);

    // Hybrid search with ML-like query embedding
    const queryEmb = fakeEmbedding(10);
    const results = storage.searchMemories("learning", "shared", "default", undefined, 10, queryEmb);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(m1.id);
  });

  it("scope filtering works in hybrid search", () => {
    const m1 = storage.storeMemory("default", "shared", null, "shared fact", null, "a1");
    const m2 = storage.storeMemory("default", "personal", "a1", "personal fact", null, "a1");

    storage.storeEmbedding(m1.id, "default", fakeEmbedding(1));
    storage.storeEmbedding(m2.id, "default", fakeEmbedding(2));

    const results = storage.searchMemories("fact", "shared", "default", undefined, 10, fakeEmbedding(1));
    const scopes = results.map((r) => r.scope);
    expect(scopes.every((s) => s === "shared")).toBe(true);
  });

  it("temporal decay does not kill recent memories", () => {
    // Regression test: DECAY_LAMBDA should not obliterate scores for recent memories
    const m = storage.storeMemory("default", "shared", null, "recent info", null, "a1");
    storage.storeEmbedding(m.id, "default", fakeEmbedding(1));

    const results = storage.searchMemories("recent", "shared", "default", undefined, 10, fakeEmbedding(1));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(m.id);
  });

  it("listAllMemories returns all scopes", () => {
    storage.storeMemory("default", "shared", null, "shared", null, "a1");
    storage.storeMemory("default", "personal", "a1", "personal", null, "a1");

    const all = storage.listAllMemories("default");
    expect(all).toHaveLength(2);
  });
});
