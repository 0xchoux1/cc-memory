// cc-memory v3.1 - Memory curation: KNN-based duplicate detection
import type { Memory } from "./types.js";
import type { Storage } from "./storage.js";

const STALE_DAYS = 90;

export interface DuplicateGroup {
  anchor: Memory;       // keep (oldest in group)
  duplicates: Memory[]; // removal candidates
  similarity: number;   // lowest similarity in group
}

export interface CurationReport {
  total_memories: number;
  duplicate_groups: DuplicateGroup[];
  stale_memories: Memory[];
  actions_taken: Array<{ action: string; memory_id: string; detail: string }>;
}

// Union-Find for grouping duplicates
class UnionFind {
  private parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
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

export function analyzeMemories(
  storage: Storage,
  memories: Memory[],
  threshold: number = 0.85
): CurationReport {
  const now = Date.now();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;

  // Stale detection
  const stale_memories = memories.filter(
    (m) => now - new Date(m.updated_at).getTime() > staleMs
  );

  // Duplicate detection via KNN
  const uf = new UnionFind();
  const similarities = new Map<string, number>(); // "id1:id2" → similarity

  for (const mem of memories) {
    // Get embedding for this memory, search for neighbors
    const neighbors = storage.vectorSearchPublic(mem.id, mem.project_id, 5);
    for (const n of neighbors) {
      if (n.memory_id === mem.id) continue;
      const similarity = 1 - n.distance;
      if (similarity >= threshold) {
        uf.union(mem.id, n.memory_id);
        const key = [mem.id, n.memory_id].sort().join(":");
        const existing = similarities.get(key);
        if (existing === undefined || similarity < existing) {
          similarities.set(key, similarity);
        }
      }
    }
  }

  // Build duplicate groups
  const memoryMap = new Map(memories.map((m) => [m.id, m]));
  const groups = uf.groups();
  const duplicate_groups: DuplicateGroup[] = [];

  for (const [, memberIds] of groups) {
    if (memberIds.length < 2) continue;

    const members = memberIds
      .map((id) => memoryMap.get(id))
      .filter((m): m is Memory => m !== undefined)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)); // oldest first

    if (members.length < 2) continue;

    // Find minimum similarity within this group
    let minSim = 1;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = [members[i].id, members[j].id].sort().join(":");
        const sim = similarities.get(key);
        if (sim !== undefined && sim < minSim) minSim = sim;
      }
    }

    duplicate_groups.push({
      anchor: members[0],
      duplicates: members.slice(1),
      similarity: minSim,
    });
  }

  return {
    total_memories: memories.length,
    duplicate_groups,
    stale_memories,
    actions_taken: [],
  };
}

export function executeCuration(
  storage: Storage,
  report: CurationReport
): CurationReport {
  const actions: CurationReport["actions_taken"] = [];

  for (const group of report.duplicate_groups) {
    for (const dup of group.duplicates) {
      storage.deleteMemory(dup.id);
      actions.push({
        action: "deleted_duplicate",
        memory_id: dup.id,
        detail: `duplicate of ${group.anchor.id} (similarity: ${group.similarity.toFixed(3)})`,
      });
    }
  }

  // Stale memories: report only, do not auto-delete
  for (const mem of report.stale_memories) {
    actions.push({
      action: "flagged_stale",
      memory_id: mem.id,
      detail: `last updated: ${mem.updated_at}`,
    });
  }

  return { ...report, actions_taken: actions };
}
