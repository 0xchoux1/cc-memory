// cc-memory v3 - Memory curation: duplicate detection and stale cleanup
import type { Storage } from "./storage.js";
import type { Memory } from "./types.js";

const STALE_DAYS = 90;
const DEFAULT_SIMILARITY_THRESHOLD = 0.85; // cosine similarity (1 - distance)

export interface DuplicateGroup {
  anchor: Memory; // oldest memory in the group (kept)
  duplicates: Memory[]; // newer memories (candidates for deletion)
}

export interface CurationReport {
  duplicates: DuplicateGroup[];
  stale: Memory[];
  deleted_count: number;
}

// Union-Find for grouping similar memories
class UnionFind {
  private parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let current = x;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  groups(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!result.has(root)) result.set(root, []);
      result.get(root)!.push(key);
    }
    return result;
  }
}

/**
 * Analyze memories for duplicates (KNN-based) and stale entries.
 * O(n × k) where k = KNN limit per memory.
 */
export function analyzeMemories(
  storage: Storage,
  memories: Memory[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): CurationReport {
  const now = Date.now();
  const staleThreshold = now - STALE_DAYS * 24 * 60 * 60 * 1000;

  // Detect stale memories
  const stale = memories.filter(
    (m) => new Date(m.updated_at).getTime() < staleThreshold
  );

  // Detect duplicates via KNN
  const uf = new UnionFind();
  const memoryMap = new Map(memories.map((m) => [m.id, m]));

  for (const memory of memories) {
    const neighbors = storage.vectorSearchPublic(memory.id, memory.project_id, 5);
    for (const neighbor of neighbors) {
      if (neighbor.memory_id === memory.id) continue;
      if (!memoryMap.has(neighbor.memory_id)) continue;

      const similarity = 1 - neighbor.distance;
      if (similarity >= threshold) {
        uf.union(memory.id, neighbor.memory_id);
      }
    }
  }

  // Build duplicate groups
  const duplicates: DuplicateGroup[] = [];
  const groups = uf.groups();

  for (const [, memberIds] of groups) {
    if (memberIds.length < 2) continue;

    const members = memberIds
      .map((id) => memoryMap.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)); // oldest first

    duplicates.push({
      anchor: members[0], // oldest = keep
      duplicates: members.slice(1), // newer = delete candidates
    });
  }

  return { duplicates, stale, deleted_count: 0 };
}

/**
 * Execute curation: delete duplicates, flag stale (report only).
 */
export function executeCuration(
  storage: Storage,
  report: CurationReport
): CurationReport {
  let deleted = 0;

  for (const group of report.duplicates) {
    for (const dup of group.duplicates) {
      if (storage.deleteMemory(dup.id)) {
        deleted++;
      }
    }
  }

  return { ...report, deleted_count: deleted };
}
