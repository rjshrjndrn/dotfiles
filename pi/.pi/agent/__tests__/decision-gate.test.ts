import { describe, it, expect, beforeEach } from "vitest";
import {
  DecisionGate,
  type TurnContext,
  type PromotionResult,
} from "../acm-lib/decision-gate.ts";

describe("DecisionGate", () => {
  let gate: DecisionGate;

  beforeEach(() => {
    gate = new DecisionGate();
  });

  describe("immediate promotion — mutations", () => {
    it("promotes edit tool calls as 'fix'", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Fixing the token expiry check: < should be <=",
        toolResults: [
          {
            toolName: "edit",
            toolCallId: "tc-1",
            input: { path: "src/auth.ts" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("promote");
      expect(results[0].event.eventType).toBe("fix");
      expect(results[0].event.files).toContain("src/auth.ts");
      expect(results[0].event.summary).toContain("token expiry");
    });

    it("promotes write tool calls as 'fix'", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Creating the config file",
        toolResults: [
          {
            toolName: "write",
            toolCallId: "tc-1",
            input: { path: "config.ts" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("promote");
      expect(results[0].event.eventType).toBe("fix");
    });

    it("captures multiple files edited in same turn", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Refactoring auth across files",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
          { toolName: "edit", toolCallId: "tc-2", input: { path: "src/middleware.ts" }, isError: false },
          { toolName: "edit", toolCallId: "tc-3", input: { path: "src/config.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1); // one event for the turn
      expect(results[0].event.files).toEqual(["src/auth.ts", "src/middleware.ts", "src/config.ts"]);
    });
  });

  describe("immediate promotion — errors", () => {
    it("promotes tool errors as 'error'", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Build failed: missing dependency",
        toolResults: [
          {
            toolName: "bash",
            toolCallId: "tc-1",
            input: { command: "npm run build" },
            isError: true,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("promote");
      expect(results[0].event.eventType).toBe("error");
    });
  });

  describe("immediate promotion — git commits", () => {
    it("promotes bash git commit as 'fix'", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Committed the change",
        toolResults: [
          {
            toolName: "bash",
            toolCallId: "tc-1",
            input: { command: "git add . && git commit -m 'fix: auth'" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].event.eventType).toBe("fix");
    });
  });

  describe("buffering — investigations", () => {
    it("buffers read tool calls", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Let me read the auth file first",
        toolResults: [
          {
            toolName: "read",
            toolCallId: "tc-1",
            input: { path: "src/auth.ts" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("buffer");
    });

    it("buffers bash grep/rg calls", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Searching for token usage",
        toolResults: [
          {
            toolName: "bash",
            toolCallId: "tc-1",
            input: { command: "rg 'token' src/" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("buffer");
    });
  });

  describe("skip — exploration noise", () => {
    it("skips ls commands", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Let me see the directory structure",
        toolResults: [
          {
            toolName: "bash",
            toolCallId: "tc-1",
            input: { command: "ls -la src/" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skip");
    });

    it("skips find commands", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Finding test files",
        toolResults: [
          {
            toolName: "bash",
            toolCallId: "tc-1",
            input: { command: "find . -name '*.test.ts'" },
            isError: false,
          },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skip");
    });
  });

  describe("linked promotion — buffered reads promoted with mutations", () => {
    it("promotes buffered reads when same file is later edited", () => {
      // Turn 1: read auth.ts → buffered
      gate.evaluate({
        turnIndex: 1,
        assistantText: "Reading auth to understand the issue",
        toolResults: [
          { toolName: "read", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      });

      // Turn 2: read middleware.ts → buffered
      gate.evaluate({
        turnIndex: 2,
        assistantText: "Checking middleware too",
        toolResults: [
          { toolName: "read", toolCallId: "tc-2", input: { path: "src/middleware.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 2000,
      });

      // Turn 3: edit auth.ts → promotes self + buffered read of auth.ts
      const results = gate.evaluate({
        turnIndex: 3,
        assistantText: "Fixed the token check in auth",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-3", input: { path: "src/auth.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 3000,
      });

      // Should return: promote for edit + linked promotion for buffered read of auth.ts
      const promoted = results.filter((r) => r.action === "promote");
      expect(promoted).toHaveLength(2); // edit event + linked read event

      // The linked read should reference auth.ts
      const linkedRead = promoted.find((r) => r.event.toolName === "read");
      expect(linkedRead).toBeDefined();
      expect(linkedRead!.event.files).toContain("src/auth.ts");
      expect(linkedRead!.event.eventType).toBe("investigation");

      // middleware.ts read should still be buffered (not promoted)
      expect(gate.getBufferedFiles()).toContain("src/middleware.ts");
    });
  });

  describe("reasoning extraction", () => {
    it("extracts first meaningful sentence as summary", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText:
          "The token expiry check uses `<` instead of `<=`. This means tokens expire one second too early. Fixing now.",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results[0].event.summary).toContain("token expiry");
    });

    it("handles empty assistant text gracefully", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      expect(results[0].event.summary).toBe("");
    });
  });

  describe("flush", () => {
    it("returns remaining buffered events on flush", () => {
      gate.evaluate({
        turnIndex: 1,
        assistantText: "Reading config",
        toolResults: [
          { toolName: "read", toolCallId: "tc-1", input: { path: "config.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      });

      const flushed = gate.flush();
      expect(flushed).toHaveLength(1);
      expect(flushed[0].files).toContain("config.ts");
      expect(gate.getBufferedFiles()).toHaveLength(0);
    });
  });

  describe("mixed turns", () => {
    it("handles turn with both reads and edits", () => {
      const turn: TurnContext = {
        turnIndex: 1,
        assistantText: "Reading and fixing auth",
        toolResults: [
          { toolName: "read", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
          { toolName: "edit", toolCallId: "tc-2", input: { path: "src/auth.ts" }, isError: false },
        ],
        sessionId: "sess-1",
        timestamp: 1000,
      };

      const results = gate.evaluate(turn);
      // Should promote (has mutation), not buffer
      const promoted = results.filter((r) => r.action === "promote");
      expect(promoted.length).toBeGreaterThanOrEqual(1);
    });
  });
});
