import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProjectGraph } from "../acm-lib/project-graph.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let g: ProjectGraph;

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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "project-graph-"));
  g = new ProjectGraph(join(dir, "repo.db"), "shared");
  await g.init();
});

afterEach(async () => {
  await g.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ProjectGraph public contract (async, RepoStore-backed)", () => {
  it("lifecycle: isReady toggles with init/close", async () => {
    expect(g.isReady()).toBe(true);
    await g.close();
    expect(g.isReady()).toBe(false);
    await g.init();
    expect(g.isReady()).toBe(true);
  });

  it("registerSession + getSessions round-trips", async () => {
    await g.registerSession({ id: "s1", startTime: 100, cwd: "/repo/wt", gitRoot: "/repo" });
    const s = await g.getSessions();
    expect(s.map((x) => x.id)).toContain("s1");
    expect(s.find((x) => x.id === "s1")).toMatchObject({ startTime: 100, cwd: "/repo/wt", gitRoot: "/repo" });
  });

  it("writeEvent is queryable by file, keyword, session, and type", async () => {
    await g.registerSession({ id: "s1", startTime: 1, cwd: "/r", gitRoot: "/r" });
    await g.writeEvent(ev({ id: "e1", toolName: "edit", keyTerms: "fix corruption", eventType: "edit", files: ["a.ts"], timestamp: 10 }));
    await g.writeEvent(ev({ id: "e2", toolName: "bash", keyTerms: "run", eventType: "tool_result", files: ["a.ts"], timestamp: 20 }));

    expect((await g.queryByFile("a.ts")).map((e) => e.id)).toEqual(["e2", "e1"]);
    expect((await g.queryByKeyword("corruption")).map((e) => e.id)).toEqual(["e1"]);
    expect((await g.getSessionEvents("s1")).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect((await g.queryByEventType("edit")).map((e) => e.id)).toEqual(["e1"]);
  });

  it("getRelated and getSequence traverse the graph", async () => {
    await g.writeEvent(ev({ id: "e1", files: ["x.ts"], timestamp: 1 }));
    await g.writeEvent(ev({ id: "e2", files: ["x.ts"], timestamp: 2 }));
    expect((await g.getRelated("e1")).map((e) => e.id)).toEqual(["e2"]);
    expect((await g.getSequence("e1", "forward")).map((e) => e.id)).toEqual(["e2"]);
  });

  it("precheckFile, getStats, getHotFiles summarize activity", async () => {
    await g.registerSession({ id: "s1", startTime: 1, cwd: "/r", gitRoot: "/r" });
    await g.writeEvent(ev({ id: "e1", keyTerms: "alpha", files: ["hot.ts"], timestamp: 5 }));
    await g.writeEvent(ev({ id: "e2", keyTerms: "beta", files: ["hot.ts"], timestamp: 9 }));

    const p = await g.precheckFile("hot.ts");
    expect(p.eventCount).toBe(2);
    expect(p.lastTouched).toBe(9);

    expect(await g.getStats()).toEqual({ events: 2, files: 1, sessions: 1 });
    expect((await g.getHotFiles())[0]).toEqual({ path: "hot.ts", refCount: 2 });
  });

  it("deleteEvents removes events and reports count", async () => {
    await g.writeEvent(ev({ id: "e1", files: ["a.ts"], timestamp: 1 }));
    await g.writeEvent(ev({ id: "e2", files: ["a.ts"], timestamp: 2 }));
    expect(await g.deleteEvents(["e1"])).toBe(1);
    expect((await g.queryByFile("a.ts")).map((e) => e.id)).toEqual(["e2"]);
  });

  it("flushWrites resolves without error", async () => {
    await g.writeEvent(ev({ id: "e1", timestamp: 1 }));
    await expect(g.flushWrites()).resolves.toBeUndefined();
  });
});
