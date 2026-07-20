import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let store: RepoStore;

const ev = (over: any = {}) => ({
  id: "e",
  toolName: "read",
  keyTerms: "",
  eventType: "tool_result",
  files: [] as string[],
  sessionId: "s1",
  timestamp: 0,
  summary: "",
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-gc-"));
  store = new RepoStore(join(dir, "repo.db"));
  store.init();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("collectGarbageByAge", () => {
  it("deletes tool_result events older than the cutoff, keeps recent ones", () => {
    store.writeEvent(ev({ id: "old", timestamp: 100, files: ["a.ts"] }));
    store.writeEvent(ev({ id: "new", timestamp: 900, files: ["b.ts"] }));

    const removed = store.collectGarbageByAge(500); // cutoff ts

    expect(removed).toBe(1);
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["new"]);
  });

  it("NEVER deletes fact nodes, even when older than the cutoff", () => {
    store.addNode({ id: "f1", type: "fact", label: "durable note", timestamp: 1 });
    store.writeEvent(ev({ id: "old", timestamp: 1 }));

    const removed = store.collectGarbageByAge(500);

    expect(removed).toBe(1); // only the event
    expect(store.search("durable").map((n) => n.id)).toContain("f1");
  });

  it("cascades edge and file cleanup via deleteEvents", () => {
    store.writeEvent(ev({ id: "old", timestamp: 100, files: ["gone.ts"] }));
    store.collectGarbageByAge(500);
    // gone.ts had only this referrer -> orphan-cleaned
    expect(store.getHotFiles().some((h) => h.path === "gone.ts")).toBe(false);
  });

  it("returns 0 when nothing is older than the cutoff", () => {
    store.writeEvent(ev({ id: "new", timestamp: 900 }));
    expect(store.collectGarbageByAge(500)).toBe(0);
  });
});
