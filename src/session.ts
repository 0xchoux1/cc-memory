// cc-memory v3.2 - Session indexing and search
// Indexes Claude Code JSONL session logs for short-term recall

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { Storage } from "./storage.js";
import type { SessionChunk } from "./types.js";
import { embed } from "./embeddings.js";

const MAX_CHUNK_CHARS = 2000;
const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

// JSONL record shape (Claude Code format)
interface SessionRecord {
  type: string;
  uuid?: string;
  timestamp?: string;
  message?: {
    id?: string;
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

// A conversation turn (user + assistant pair)
interface Turn {
  userText: string;
  assistantText: string;
  timestamp: string;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  expired_deleted: number;
}

// --- Public API ---

export function parseSessionFile(filePath: string): SessionChunk[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const sessionId = basename(filePath, ".jsonl");
  const projectPath = extractProjectPath(filePath);

  const turns = extractTurns(lines);
  const chunks: SessionChunk[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const text = `[User]: ${turn.userText}\n\n[Assistant]: ${turn.assistantText}`;

    // Split if too long
    const segments = splitText(text, MAX_CHUNK_CHARS);
    for (let s = 0; s < segments.length; s++) {
      const chunkIndex = chunks.length;
      chunks.push({
        id: `${sessionId}:${chunkIndex}`,
        session_id: sessionId,
        project_path: projectPath,
        chunk_index: chunkIndex,
        content: segments[s],
        timestamp: turn.timestamp,
        indexed_at: now,
      });
    }
  }

  return chunks;
}

export async function indexNewSessions(
  storage: Storage,
  days: number
): Promise<IndexResult> {
  const cutoff = new Date(Date.now() - days * 86400_000);
  const expiryCutoff = new Date(Date.now() - days * 86400_000).toISOString();

  // Clean up expired chunks first
  const expired_deleted = storage.deleteExpiredChunks(expiryCutoff);

  const indexed = storage.getIndexedSessionIds();
  const sessionFiles = findSessionFiles(cutoff);

  let indexedCount = 0;
  let skippedCount = 0;

  for (const filePath of sessionFiles) {
    const sessionId = basename(filePath, ".jsonl");
    if (indexed.has(sessionId)) {
      skippedCount++;
      continue;
    }

    try {
      const chunks = parseSessionFile(filePath);
      for (const chunk of chunks) {
        let embedding: Float32Array | undefined;
        if (storage.vectorEnabled) {
          try {
            embedding = (await embed(chunk.content)) ?? undefined;
          } catch {
            // embedding generation failed, continue without it
          }
        }
        storage.storeSessionChunk(chunk, embedding);
      }
      indexedCount++;
    } catch {
      // Skip unreadable files
      skippedCount++;
    }
  }

  return { indexed: indexedCount, skipped: skippedCount, expired_deleted };
}

export async function searchChunks(
  storage: Storage,
  query: string,
  opts: { days?: number; limit?: number; queryEmbedding?: Float32Array }
): Promise<SessionChunk[]> {
  const { limit = 10, queryEmbedding } = opts;

  return storage.searchSessionChunks(queryEmbedding, query, limit);
}

// --- Internal helpers ---

function extractTurns(lines: string[]): Turn[] {
  const records: SessionRecord[] = [];
  const seenIds = new Set<string>();

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as SessionRecord;
      const recType = record.type;
      if (recType !== "user" && recType !== "assistant") continue;

      // Dedup assistant streaming duplicates by message.id
      const msgId = record.message?.id;
      if (msgId) {
        if (seenIds.has(msgId)) continue;
        seenIds.add(msgId);
      }

      records.push(record);
    } catch {
      // skip unparseable lines
    }
  }

  // Pair up user + assistant turns
  const turns: Turn[] = [];
  let i = 0;
  while (i < records.length) {
    if (records[i].type === "user") {
      const userText = extractText(records[i]);
      const timestamp = records[i].timestamp || new Date().toISOString();

      // Look for next assistant
      if (i + 1 < records.length && records[i + 1].type === "assistant") {
        const assistantText = extractText(records[i + 1]);
        if (userText && assistantText) {
          turns.push({ userText, assistantText, timestamp });
        }
        i += 2;
      } else {
        // User without assistant response — skip
        i++;
      }
    } else {
      // assistant without preceding user — skip
      i++;
    }
  }

  return turns;
}

function extractText(record: SessionRecord): string {
  const content = record.message?.content;
  if (!content) return "";

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        texts.push(block);
      } else if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
    return texts.join("\n").trim();
  }

  return "";
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const segments: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    // Try to break at a newline boundary
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start + maxChars / 2) {
        end = lastNewline + 1;
      }
    }
    segments.push(text.slice(start, end));
    start = end;
  }
  return segments;
}

function extractProjectPath(filePath: string): string {
  // ~/.claude/projects/<project-path>/<session-id>.jsonl
  const projectsIdx = filePath.indexOf(".claude/projects/");
  if (projectsIdx === -1) return "unknown";
  const after = filePath.slice(projectsIdx + ".claude/projects/".length);
  const slashIdx = after.indexOf("/");
  return slashIdx > 0 ? after.slice(0, slashIdx) : after;
}

function findSessionFiles(cutoff: Date): string[] {
  const files: string[] = [];

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
    for (const dir of projectDirs) {
      const projectDir = join(CLAUDE_PROJECTS_DIR, dir);
      try {
        const stat = statSync(projectDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      try {
        const entries = readdirSync(projectDir);
        for (const entry of entries) {
          if (!entry.endsWith(".jsonl")) continue;
          // Skip subagents directory
          if (entry === "subagents") continue;

          const fullPath = join(projectDir, entry);
          try {
            const stat = statSync(fullPath);
            if (stat.isFile() && stat.mtime >= cutoff) {
              files.push(fullPath);
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip unreadable dirs
      }
    }
  } catch {
    // CLAUDE_PROJECTS_DIR doesn't exist
  }

  return files;
}
