import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const storePath = fileURLToPath(new URL("../acm-lib/repo-store.ts", import.meta.url));

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-crash-"));
  dbPath = join(dir, "repo.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RepoStore crash safety (WAL recovery)", () => {
  it("recovers ALL rows after a SIGKILL mid-write (no wipe)", () => {
    // Fixture: init RepoStore (WAL + schema), insert 50 rows, then SIGKILL
    // WITHOUT ever calling close(). This is the exact scenario that wiped the
    // old LadybugDB. SQLite WAL must self-recover on next open.
    const fixture = join(dir, "crash-writer.ts");
    writeFileSync(
      fixture,
      `
import { RepoStore } from ${JSON.stringify(storePath)};
import { DatabaseSync } from "node:sqlite";
const dbPath = process.argv[2];
const s = new RepoStore(dbPath);
s.init();
const raw = new DatabaseSync(dbPath);
raw.exec("PRAGMA busy_timeout=5000");
const stmt = raw.prepare("INSERT INTO nodes(id,type,label,body,ts) VALUES(?,?,?,?,?)");
for (let i = 0; i < 50; i++) stmt.run("n" + i, "fact", "label " + i, "", Date.now());
process.kill(process.pid, "SIGKILL");
`,
    );

    const res = spawnSync(process.execPath, ["--experimental-strip-types", fixture, dbPath]);
    // Proc must have been terminated by our SIGKILL, never exiting cleanly.
    expect(res.signal).toBe("SIGKILL");

    // Fresh open: reopen and count. Must be all 50, no corruption/wipe.
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare("SELECT count(*) AS n FROM nodes").get() as { n: number };
    raw.close();
    expect(row.n).toBe(50);
  });

  it("RepoStore reopens a crashed db without throwing", () => {
    const fixture = join(dir, "crash-writer2.ts");
    writeFileSync(
      fixture,
      `
import { RepoStore } from ${JSON.stringify(storePath)};
import { DatabaseSync } from "node:sqlite";
const dbPath = process.argv[2];
const s = new RepoStore(dbPath);
s.init();
const raw = new DatabaseSync(dbPath);
raw.prepare("INSERT INTO nodes(id,type,label,body,ts) VALUES(?,?,?,?,?)")
   .run("x", "fact", "y", "", Date.now());
process.kill(process.pid, "SIGKILL");
`,
    );
    spawnSync(process.execPath, ["--experimental-strip-types", fixture, dbPath]);

    const s = new RepoStore(dbPath);
    expect(() => s.init()).not.toThrow();
    expect(s.isReady()).toBe(true);
    s.close();
  });
});
