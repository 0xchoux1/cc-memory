// cc-memory v2 search - text-based search utilities
// Currently delegates to Storage.searchMemories which does keyword matching.
// This module exists as the extension point for future semantic search.

import type { Memory } from "./types.js";

/**
 * Score a memory against a query string.
 * Returns 0 if no match, higher = better match.
 */
export function scoreMemory(memory: Memory, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;

  const text = (memory.content + " " + (memory.tags?.join(" ") ?? "")).toLowerCase();
  let score = 0;

  for (const term of terms) {
    // Exact word boundary match scores higher
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (regex.test(text)) {
      score += 2;
    } else if (text.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filter and rank memories by query relevance.
 */
export function filterAndRank(memories: Memory[], query: string, limit: number): Memory[] {
  return memories
    .map((m) => ({ memory: m, score: scoreMemory(m, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.memory);
}
