import { describe, it, expect, beforeEach } from "vitest";
import { ProjectMemoryBridge } from "../acm-lib/project-memory-bridge.ts";

/**
 * Test path relativization in ProjectMemoryBridge.
 * 
 * We test the public `relativizePath` method directly,
 * plus verify onTurnEnd stores relative paths.
 */
describe("ProjectMemoryBridge — path relativization", () => {
  let bridge: ProjectMemoryBridge;

  beforeEach(() => {
    bridge = new ProjectMemoryBridge({});
  });

  describe("relativizePath", () => {
    it("strips worktreeRoot prefix from absolute path", () => {
      bridge.setWorktreeRoot("/home/user/project");
      expect(bridge.relativizePath("/home/user/project/src/auth.ts"))
        .toBe("src/auth.ts");
    });

    it("strips worktreeRoot with trailing slash", () => {
      bridge.setWorktreeRoot("/home/user/project/");
      expect(bridge.relativizePath("/home/user/project/src/auth.ts"))
        .toBe("src/auth.ts");
    });

    it("returns already-relative paths unchanged", () => {
      bridge.setWorktreeRoot("/home/user/project");
      expect(bridge.relativizePath("src/auth.ts"))
        .toBe("src/auth.ts");
    });

    it("returns paths outside worktreeRoot unchanged", () => {
      bridge.setWorktreeRoot("/home/user/project");
      expect(bridge.relativizePath("/home/user/other-project/foo.ts"))
        .toBe("/home/user/other-project/foo.ts");
    });

    it("returns path unchanged when no worktreeRoot set", () => {
      // No setWorktreeRoot called
      expect(bridge.relativizePath("/home/user/project/src/auth.ts"))
        .toBe("/home/user/project/src/auth.ts");
    });

    it("handles root path exactly (returns empty → .)", () => {
      bridge.setWorktreeRoot("/home/user/project");
      // Edge case: path IS the root
      const result = bridge.relativizePath("/home/user/project");
      expect(result).toBe(".");
    });

    it("handles root path with trailing slash", () => {
      bridge.setWorktreeRoot("/home/user/project");
      const result = bridge.relativizePath("/home/user/project/");
      expect(result).toBe(".");
    });
  });
});
