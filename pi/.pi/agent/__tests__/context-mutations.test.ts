import { describe, it, expect } from "vitest";
import { injectAcmContext, prependPinned } from "../acm-lib/context-mutations.ts";

// Helper: assert every message in array resolves to an entry ID
function assertAllPinnable(messages: any[], msgEntryId: Map<any, string>) {
  for (const msg of messages) {
    expect(msgEntryId.get(msg), `message not mapped: ${JSON.stringify(msg).slice(0, 60)}`).toBeDefined();
  }
}

describe("injectAcmContext", () => {
  it("prepends acm-context to first user message", () => {
    const userMsg = { role: "user", content: "hello" };
    const messages = [userMsg];
    const msgEntryId = new Map<any, string>([[userMsg, "aaa11111"]]);

    injectAcmContext(messages, msgEntryId, "<acm-context>info</acm-context>");

    const content = messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text).toContain("acm-context");
  });

  it("preserves entry ID on the new (replaced) message object", () => {
    const userMsg = { role: "user", content: "hello" };
    const messages = [userMsg];
    const msgEntryId = new Map<any, string>([[userMsg, "aaa11111"]]);

    injectAcmContext(messages, msgEntryId, "<acm-context>info</acm-context>");

    // The message object was replaced — new ref must still map to same entry ID
    expect(messages[0]).not.toBe(userMsg); // new object
    expect(msgEntryId.get(messages[0])).toBe("aaa11111");
  });

  it("only injects into the FIRST user message", () => {
    const u1 = { role: "user", content: "first" };
    const a1 = { role: "assistant", content: "reply" };
    const u2 = { role: "user", content: "second" };
    const messages = [u1, a1, u2];
    const msgEntryId = new Map<any, string>([[u1, "id1"], [a1, "id2"], [u2, "id3"]]);

    injectAcmContext(messages, msgEntryId, "CTX");

    expect(Array.isArray(messages[0].content)).toBe(true);
    expect(messages[2].content).toBe("second"); // untouched
  });

  it("handles array content on the first user message", () => {
    const userMsg = { role: "user", content: [{ type: "text", text: "hi" }] };
    const messages = [userMsg];
    const msgEntryId = new Map<any, string>([[userMsg, "aaa11111"]]);

    injectAcmContext(messages, msgEntryId, "CTX");

    expect(messages[0].content[0].text).toBe("CTX");
    expect(messages[0].content[1].text).toBe("hi");
    expect(msgEntryId.get(messages[0])).toBe("aaa11111");
  });

  it("no-op when no user message present", () => {
    const a1 = { role: "assistant", content: "reply" };
    const messages = [a1];
    const msgEntryId = new Map<any, string>([[a1, "id1"]]);

    injectAcmContext(messages, msgEntryId, "CTX");

    expect(messages[0]).toBe(a1); // unchanged
  });
});

describe("prependPinned", () => {
  it("prepends pinned content as synthetic messages", () => {
    const messages: any[] = [{ role: "user", content: "current" }];
    const msgEntryId = new Map<any, string>();
    const pinnedContentStore = new Map<string, any>([
      ["xyz99999", { content: "important earlier note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["xyz99999"]);
    const branch: any[] = []; // entry slid away, not in branch

    prependPinned(messages, msgEntryId, pinnedContentStore, pinnedSet, branch);

    expect(messages.length).toBe(2);
    expect(messages[0].content[0].text).toContain("important earlier note");
  });

  it("maps synthetic pinned message to its entry ID", () => {
    const messages: any[] = [];
    const msgEntryId = new Map<any, string>();
    const pinnedContentStore = new Map<string, any>([
      ["xyz99999", { content: "note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["xyz99999"]);
    const branch: any[] = [];

    prependPinned(messages, msgEntryId, pinnedContentStore, pinnedSet, branch);

    expect(msgEntryId.get(messages[0])).toBe("xyz99999");
  });

  it("skips pins that were removed from pinnedSet", () => {
    const messages: any[] = [];
    const msgEntryId = new Map<any, string>();
    const pinnedContentStore = new Map<string, any>([
      ["xyz99999", { content: "note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(); // unpinned
    const branch: any[] = [];

    prependPinned(messages, msgEntryId, pinnedContentStore, pinnedSet, branch);

    expect(messages.length).toBe(0);
  });

  it("skips pins whose entry still exists in branch (not yet slid)", () => {
    const messages: any[] = [];
    const msgEntryId = new Map<any, string>();
    const pinnedContentStore = new Map<string, any>([
      ["xyz99999", { content: "note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["xyz99999"]);
    const branch: any[] = [{ id: "xyz99999", type: "message", message: {} }];

    prependPinned(messages, msgEntryId, pinnedContentStore, pinnedSet, branch);

    expect(messages.length).toBe(0);
  });
});

describe("INVARIANT: every visible message is pinnable", () => {
  it("holds after inject + prepend combined", () => {
    const u1 = { role: "user", content: "current question" };
    const a1 = { role: "assistant", content: "answer" };
    const messages: any[] = [u1, a1];
    const msgEntryId = new Map<any, string>([[u1, "id-user"], [a1, "id-asst"]]);

    const pinnedContentStore = new Map<string, any>([
      ["pin00001", { content: "pinned note A", role: "user" }],
      ["pin00002", { content: "pinned note B", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["pin00001", "pin00002"]);
    const branch: any[] = [];

    injectAcmContext(messages, msgEntryId, "CTX");
    prependPinned(messages, msgEntryId, pinnedContentStore, pinnedSet, branch);

    // Every message the LLM sees must resolve to an entry ID
    assertAllPinnable(messages, msgEntryId);
  });
});
