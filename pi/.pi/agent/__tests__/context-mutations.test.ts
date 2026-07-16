import { describe, it, expect } from "vitest";
import { injectAcmContext, prependPinned } from "../acm-lib/context-mutations.ts";

describe("injectAcmContext", () => {
  it("prepends acm-context to first user message", () => {
    const userMsg = { role: "user", content: "hello" };
    const messages = [userMsg];

    injectAcmContext(messages, "<acm-context>info</acm-context>");

    const content = messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text).toContain("acm-context");
  });

  it("only injects into the FIRST user message", () => {
    const u1 = { role: "user", content: "first" };
    const a1 = { role: "assistant", content: "reply" };
    const u2 = { role: "user", content: "second" };
    const messages = [u1, a1, u2];

    injectAcmContext(messages, "CTX");

    expect(Array.isArray(messages[0].content)).toBe(true);
    expect(messages[2].content).toBe("second"); // untouched
  });

  it("handles array content on the first user message", () => {
    const userMsg = { role: "user", content: [{ type: "text", text: "hi" }] };
    const messages = [userMsg];

    injectAcmContext(messages, "CTX");

    expect(messages[0].content[0].text).toBe("CTX");
    expect(messages[0].content[1].text).toBe("hi");
  });

  it("replaces the message object at the same index (position preserved)", () => {
    const u1 = { role: "user", content: "x" };
    const a1 = { role: "assistant", content: "y" };
    const messages = [u1, a1];

    injectAcmContext(messages, "CTX");

    expect(messages.length).toBe(2);
    expect(messages[1]).toBe(a1); // index 1 untouched
  });

  it("no-op when no user message present", () => {
    const a1 = { role: "assistant", content: "reply" };
    const messages = [a1];

    injectAcmContext(messages, "CTX");

    expect(messages[0]).toBe(a1); // unchanged
  });
});

describe("prependPinned", () => {
  it("prepends pinned content as synthetic messages", () => {
    const messages: any[] = [{ role: "user", content: "current" }];
    const store = new Map<string, any>([
      ["xyz99999", { content: "important earlier note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["xyz99999"]);
    const branch: any[] = []; // entry slid away, not in branch

    prependPinned(messages, store, pinnedSet, branch);

    expect(messages.length).toBe(2);
    expect(messages[0].content[0].text).toContain("important earlier note");
  });

  it("returns prepended entry IDs in message order", () => {
    const messages: any[] = [{ role: "user", content: "current" }];
    const store = new Map<string, any>([
      ["aaa00001", { content: "note A", role: "user" }],
      ["bbb00002", { content: "note B", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["aaa00001", "bbb00002"]);
    const branch: any[] = [];

    const ids = prependPinned(messages, store, pinnedSet, branch);

    expect(ids).toEqual(["aaa00001", "bbb00002"]);
    // ids align with the prepended messages (front of array)
    expect(messages[0].content[0].text).toContain("note A");
    expect(messages[1].content[0].text).toContain("note B");
  });

  it("skips pins that were removed from pinnedSet", () => {
    const messages: any[] = [];
    const store = new Map<string, any>([
      ["xyz99999", { content: "note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(); // unpinned
    const branch: any[] = [];

    const ids = prependPinned(messages, store, pinnedSet, branch);

    expect(messages.length).toBe(0);
    expect(ids).toEqual([]);
  });

  it("skips pins whose entry still exists in branch (not yet slid)", () => {
    const messages: any[] = [];
    const store = new Map<string, any>([
      ["xyz99999", { content: "note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["xyz99999"]);
    const branch: any[] = [{ id: "xyz99999", type: "message", message: {} }];

    const ids = prependPinned(messages, store, pinnedSet, branch);

    expect(messages.length).toBe(0);
    expect(ids).toEqual([]);
  });

  it("embeds short entry ID in the synthetic marker", () => {
    const messages: any[] = [];
    const store = new Map<string, any>([
      ["abcdef1234567", { content: "note", role: "user" }],
    ]);
    const pinnedSet = new Set<string>(["abcdef1234567"]);
    const branch: any[] = [];

    prependPinned(messages, store, pinnedSet, branch);

    expect(messages[0].content[0].text).toContain("[pinned:abcdef12]");
  });
});
