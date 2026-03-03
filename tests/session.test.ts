import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseSessionFile } from "../src/session.js";
import { Storage } from "../src/storage.js";
import { createToolHandler } from "../src/tools.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-session.db";
const TEST_DIR = "test-sessions-tmp";

// Helper: create a JSONL session file with user/assistant turns
function createSessionFile(
  dir: string,
  sessionId: string,
  turns: Array<{ user: string; assistant: string; timestamp?: string }>
): string {
  const filePath = join(dir, `${sessionId}.jsonl`);
  const lines: string[] = [];

  for (const turn of turns) {
    const ts = turn.timestamp || new Date().toISOString();
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: `u-${Math.random().toString(36).slice(2)}`,
        timestamp: ts,
        message: { role: "user", content: turn.user },
      })
    );
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: `a-${Math.random().toString(36).slice(2)}`,
        timestamp: ts,
        message: {
          id: `msg-${Math.random().toString(36).slice(2)}`,
          role: "assistant",
          content: [{ type: "text", text: turn.assistant }],
        },
      })
    );
  }

  writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}

describe("parseSessionFile", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("parses user/assistant turns into chunks", () => {
    const filePath = createSessionFile(TEST_DIR, "test-session-1", [
      { user: "Hello", assistant: "Hi there!" },
      { user: "How are you?", assistant: "I'm fine, thanks." },
    ]);

    const chunks = parseSessionFile(filePath);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain("[User]: Hello");
    expect(chunks[0].content).toContain("[Assistant]: Hi there!");
    expect(chunks[0].session_id).toBe("test-session-1");
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[1].chunk_index).toBe(1);
  });

  it("deduplicates assistant messages by message.id (keeps last/complete)", () => {
    const filePath = join(TEST_DIR, "dedup-session.jsonl");
    const msgId = "msg-duplicate";
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: new Date().toISOString(),
        message: { role: "user", content: "Hello" },
      }),
      // First assistant (streaming partial)
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: new Date().toISOString(),
        message: { id: msgId, role: "assistant", content: [{ type: "text", text: "Partial..." }] },
      }),
      // Second assistant (same id, full response)
      JSON.stringify({
        type: "assistant",
        uuid: "a2",
        timestamp: new Date().toISOString(),
        message: { id: msgId, role: "assistant", content: [{ type: "text", text: "Full response" }] },
      }),
    ];
    writeFileSync(filePath, lines.join("\n") + "\n");

    const chunks = parseSessionFile(filePath);
    // Last occurrence kept (complete response, not partial)
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Full response");
  });

  it("splits long turns into multiple chunks", () => {
    const longText = "A".repeat(3000);
    const filePath = createSessionFile(TEST_DIR, "long-session", [
      { user: "Question", assistant: longText },
    ]);

    const chunks = parseSessionFile(filePath);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks belong to same session
    for (const chunk of chunks) {
      expect(chunk.session_id).toBe("long-session");
    }
  });

  it("skips non-user/assistant records", () => {
    const filePath = join(TEST_DIR, "mixed-session.jsonl");
    const lines = [
      JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: new Date().toISOString(),
        message: { role: "user", content: "Real question" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: new Date().toISOString(),
        message: { id: "msg1", role: "assistant", content: [{ type: "text", text: "Real answer" }] },
      }),
      JSON.stringify({ type: "system", message: { content: "system message" } }),
    ];
    writeFileSync(filePath, lines.join("\n") + "\n");

    const chunks = parseSessionFile(filePath);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Real question");
  });

  it("handles string content format", () => {
    const filePath = join(TEST_DIR, "string-content.jsonl");
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: new Date().toISOString(),
        message: { role: "user", content: "String content" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: new Date().toISOString(),
        message: { id: "msg1", role: "assistant", content: "String response" },
      }),
    ];
    writeFileSync(filePath, lines.join("\n") + "\n");

    const chunks = parseSessionFile(filePath);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("String content");
    expect(chunks[0].content).toContain("String response");
  });
});

describe("session_recall tool", () => {
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

  beforeEach(async () => {
    // Register agent for auth
    await handle("agent_register", { project_id: "default", agent_id: "claude-code", role: "manager" });
  });

  it("returns results with index_stats", async () => {
    const result = await parse("session_recall", {
      query: "test query",
      caller_id: "claude-code",
    });
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("count");
    expect(result).toHaveProperty("index_stats");
    expect(result).toHaveProperty("chunks");
  });

  it("accepts custom days and limit", async () => {
    const result = await parse("session_recall", {
      query: "test",
      caller_id: "claude-code",
      days: 1,
      limit: 5,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unregistered caller", async () => {
    const result = await parse("session_recall", {
      query: "test",
      caller_id: "unknown-agent",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not registered");
  });

  it("rejects invalid days", async () => {
    const result = await parse("session_recall", {
      query: "test",
      caller_id: "claude-code",
      days: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid limit", async () => {
    const result = await parse("session_recall", {
      query: "test",
      caller_id: "claude-code",
      limit: 100,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Storage session_chunks", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("stores and retrieves session chunks", () => {
    const chunk = {
      id: "sess1:0",
      session_id: "sess1",
      project_path: "test-project",
      chunk_index: 0,
      content: "Test chunk content about TypeScript",
      timestamp: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
    };

    storage.storeSessionChunk(chunk);
    const indexed = storage.getIndexedSessionIds();
    expect(indexed.has("sess1")).toBe(true);
  });

  it("ignores duplicate chunk ids", () => {
    const chunk = {
      id: "sess1:0",
      session_id: "sess1",
      project_path: "test-project",
      chunk_index: 0,
      content: "Original content",
      timestamp: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
    };

    storage.storeSessionChunk(chunk);
    // Second insert should be ignored (OR IGNORE)
    storage.storeSessionChunk({ ...chunk, content: "Updated content" });

    const indexed = storage.getIndexedSessionIds();
    expect(indexed.has("sess1")).toBe(true);
  });

  it("deletes expired chunks", () => {
    const old = new Date(Date.now() - 10 * 86400_000).toISOString();
    const recent = new Date().toISOString();

    storage.storeSessionChunk({
      id: "old:0", session_id: "old", project_path: "p",
      chunk_index: 0, content: "old data", timestamp: old, indexed_at: old,
    });
    storage.storeSessionChunk({
      id: "new:0", session_id: "new", project_path: "p",
      chunk_index: 0, content: "new data", timestamp: recent, indexed_at: recent,
    });

    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const deleted = storage.deleteExpiredChunks(cutoff);
    expect(deleted).toBe(1);

    const indexed = storage.getIndexedSessionIds();
    expect(indexed.has("old")).toBe(false);
    expect(indexed.has("new")).toBe(true);
  });

  it("keyword searches session chunks", () => {
    storage.storeSessionChunk({
      id: "s1:0", session_id: "s1", project_path: "p",
      chunk_index: 0, content: "Discussion about TypeScript generics",
      timestamp: new Date().toISOString(), indexed_at: new Date().toISOString(),
    });
    storage.storeSessionChunk({
      id: "s1:1", session_id: "s1", project_path: "p",
      chunk_index: 1, content: "Python list comprehension tips",
      timestamp: new Date().toISOString(), indexed_at: new Date().toISOString(),
    });

    // searchSessionChunks with empty embedding falls back to keyword
    const results = storage.searchSessionChunks(new Float32Array(0), "TypeScript", 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
  });
});
