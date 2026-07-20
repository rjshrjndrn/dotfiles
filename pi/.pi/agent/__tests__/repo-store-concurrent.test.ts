import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const storePath = fileURLToPath(new URL("../acm-lib/repo-store.ts", import.meta.url));

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-conc-"));
  dbPath = join(dir, "repo.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(fixture: string, ...args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--experimental-strip-types", fixture, ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code !== 0) throw new Error(`writer exited ${code}: ${err}`);
      resolve(code ?? 0);
    });
  });
}

describe("RepoStore concurrent worktree writers", () => {
  it("two processes writing the same repo.db lose no data (busy_timeout serializes)", async () => {
    const M = 100;
    const fixture = join(dir, "writer.ts");
    writeFileSync(
      fixture,
      `
import { RepoStore } from ${JSON.stringify(storePath)};
const [dbPath, prefix, count] = [process.argv[2], process.argv[3], Number(process.argv[4])];
const s = new RepoStore(dbPath);
s.init();
s.registerSession({ id: prefix, startTime: Date.now(), cwd: "/repo/" + prefix, gitRoot: "/repo" });
for (let i = 0; i < count; i++) {
  s.writeEvent({
    id: prefix + i, toolName: "read", keyTerms: "k" + i, eventType: "tool_result",
    files: ["shared.ts"], sessionId: prefix, timestamp: Date.now() + i, worktree: "/repo/" + prefix,
  });
}
s.close();
`,
    );

    // Fire both worktree writers in parallel against the SAME db file.
    await Promise.all([
      run(fixture, dbPath, "a", String(M)),
      run(fixture, dbPath, "b", String(M)),
    ]);

    const store = new RepoStore(dbPath);
    store.init();
    const stats = store.getStats();
    const aEvents = store.getSessionEvents("a").length;
    const bEvents = store.getSessionEvents("b").length;
    store.close();

    expect(stats.events).toBe(2 * M); // no lost writes
    expect(stats.sessions).toBe(2);
    expect(aEvents).toBe(M);
    expect(bEvents).toBe(M);
  }, 20000);
});
