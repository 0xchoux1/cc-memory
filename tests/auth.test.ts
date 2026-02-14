import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/storage.js";
import { checkStorePermission, checkReadPermission, AuthError } from "../src/auth.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "test-auth.db";

describe("Auth", () => {
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
  });

  describe("checkStorePermission", () => {
    it("allows manager to write shared", () => {
      expect(() => checkStorePermission(storage, "p1", "mgr", "shared")).not.toThrow();
    });

    it("blocks worker from writing shared", () => {
      expect(() => checkStorePermission(storage, "p1", "wkr", "shared")).toThrow(AuthError);
    });

    it("allows worker to write personal", () => {
      expect(() => checkStorePermission(storage, "p1", "wkr", "personal")).not.toThrow();
    });

    it("throws for unregistered agent", () => {
      expect(() => checkStorePermission(storage, "p1", "unknown", "personal")).toThrow(AuthError);
    });
  });

  describe("checkReadPermission", () => {
    it("allows everyone to read shared", () => {
      expect(() => checkReadPermission(storage, "p1", "wkr", "shared")).not.toThrow();
    });

    it("allows worker to read own personal", () => {
      expect(() => checkReadPermission(storage, "p1", "wkr", "personal", "wkr")).not.toThrow();
    });

    it("blocks worker from reading others personal", () => {
      expect(() => checkReadPermission(storage, "p1", "wkr", "personal", "mgr")).toThrow(AuthError);
    });

    it("allows manager to read others personal", () => {
      expect(() => checkReadPermission(storage, "p1", "mgr", "personal", "wkr")).not.toThrow();
    });
  });
});
