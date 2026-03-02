import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-storage.db";

describe("Storage", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DB);
  });

  afterEach(() => {
    storage.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  describe("projects", () => {
    it("creates and lists projects", () => {
      storage.createProject("proj1", "Test project");
      const projects = storage.listProjects();
      // default + proj1
      expect(projects.length).toBeGreaterThanOrEqual(2);
      expect(projects.find((p) => p.id === "proj1")).toBeDefined();
    });

    it("gets a project by id", () => {
      storage.createProject("proj1", "Test");
      expect(storage.getProject("proj1")).toBeDefined();
      expect(storage.getProject("nope")).toBeUndefined();
    });

    it("default project exists automatically", () => {
      const project = storage.getProject("default");
      expect(project).toBeDefined();
      expect(project!.id).toBe("default");
    });
  });

  describe("agents", () => {
    it("registers and lists agents", () => {
      storage.createProject("p1", "test");
      storage.registerAgent("p1", "agent-a", "manager");
      storage.registerAgent("p1", "agent-b", "worker");
      const agents = storage.listAgents("p1");
      expect(agents).toHaveLength(2);
    });

    it("gets agent by project and id", () => {
      storage.createProject("p1", "test");
      storage.registerAgent("p1", "a1", "worker");
      const agent = storage.getAgent("p1", "a1");
      expect(agent?.role).toBe("worker");
    });

    it("upserts agent on re-register", () => {
      storage.createProject("p1", "test");
      storage.registerAgent("p1", "a1", "worker");
      storage.registerAgent("p1", "a1", "manager");
      expect(storage.getAgent("p1", "a1")?.role).toBe("manager");
    });
  });

  describe("memories", () => {
    it("stores and lists shared memories", () => {
      storage.createProject("p1", "test");
      storage.storeMemory("p1", "shared", null, "Hello world", ["greeting"]);
      const memories = storage.listMemories("shared", "p1");
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe("Hello world");
      expect(memories[0].tags).toEqual(["greeting"]);
    });

    it("stores and lists personal memories", () => {
      storage.storeMemory("p1", "personal", "agent-a", "My note", null);
      const memories = storage.listMemories("personal", "p1", "agent-a");
      expect(memories).toHaveLength(1);
      expect(memories[0].agent_id).toBe("agent-a");
    });

    it("deletes a memory", () => {
      const m = storage.storeMemory("p1", "shared", null, "delete me", null);
      expect(storage.deleteMemory(m.id)).toBe(true);
      expect(storage.getMemory(m.id)).toBeUndefined();
    });

    it("searches memories by keyword", () => {
      storage.storeMemory("p1", "shared", null, "TypeScript is great", ["ts"]);
      storage.storeMemory("p1", "shared", null, "Python is cool", ["py"]);
      const results = storage.searchMemories("TypeScript", "shared", "p1");
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("TypeScript");
    });

    it("records created_by", () => {
      const m = storage.storeMemory("p1", "shared", null, "Team note", null, "agent-x");
      expect(m.created_by).toBe("agent-x");
      const fetched = storage.getMemory(m.id);
      expect(fetched?.created_by).toBe("agent-x");
    });

    it("created_by defaults to null", () => {
      const m = storage.storeMemory("p1", "shared", null, "No author", null);
      expect(m.created_by).toBeNull();
    });

    it("updates content only (tags preserved)", () => {
      const m = storage.storeMemory("p1", "shared", null, "Original", ["tag1", "tag2"]);
      const updated = storage.updateMemory(m.id, "agent-a", { content: "Updated content" });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("Updated content");
      expect(updated!.tags).toEqual(["tag1", "tag2"]);
    });

    it("updates content and tags together", () => {
      const m = storage.storeMemory("p1", "shared", null, "Original", ["old-tag"]);
      const updated = storage.updateMemory(m.id, "agent-a", { content: "Updated content", tags: ["new-tag1", "new-tag2"] });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("Updated content");
      expect(updated!.tags).toEqual(["new-tag1", "new-tag2"]);
    });

    it("updates tags to empty array", () => {
      const m = storage.storeMemory("p1", "shared", null, "Content", ["tag1"]);
      const updated = storage.updateMemory(m.id, "agent-a", { content: "Content", tags: [] });
      expect(updated).not.toBeNull();
      expect(updated!.tags).toEqual([]);
    });

    it("updates tags only (content preserved)", () => {
      const m = storage.storeMemory("p1", "shared", null, "Keep this content", ["old-tag"]);
      const updated = storage.updateMemory(m.id, "agent-a", { tags: ["new-tag"] });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("Keep this content");
      expect(updated!.tags).toEqual(["new-tag"]);
    });
  });
});
