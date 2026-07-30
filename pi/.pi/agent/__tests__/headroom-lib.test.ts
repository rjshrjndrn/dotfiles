import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readPidFile,
  writePidFile,
  removePidFile,
  isHeadroomPid,
} from "../extensions/headroom-lib.ts";

let dir: string;
let pidPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "headroom-lib-"));
  pidPath = join(dir, "headroom.pid");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readPidFile", () => {
  it("returns null when file is missing", () => {
    expect(readPidFile(pidPath)).toBeNull();
  });

  it("parses a numeric pid, ignoring trailing newline", () => {
    writeFileSync(pidPath, "12345\n");
    expect(readPidFile(pidPath)).toBe(12345);
  });

  it("returns null for non-numeric garbage", () => {
    writeFileSync(pidPath, "not-a-pid");
    expect(readPidFile(pidPath)).toBeNull();
  });
});

describe("writePidFile / removePidFile", () => {
  it("round-trips a pid through write then read", () => {
    writePidFile(pidPath, 4242);
    expect(readPidFile(pidPath)).toBe(4242);
  });

  it("removePidFile deletes the file", () => {
    writePidFile(pidPath, 7);
    removePidFile(pidPath);
    expect(existsSync(pidPath)).toBe(false);
  });

  it("removePidFile is a no-op when file is already gone", () => {
    expect(() => removePidFile(pidPath)).not.toThrow();
  });
});

describe("isHeadroomPid (PID-recycling guard)", () => {
  it("is true when the pid's cmdline mentions headroom", () => {
    const readCmdline = () => "/usr/bin/python\0-m\0headroom\0proxy\0";
    expect(isHeadroomPid(210426, readCmdline)).toBe(true);
  });

  it("is false when the pid belongs to an unrelated process", () => {
    const readCmdline = () => "/opt/google/chrome/chrome\0--type=renderer\0";
    expect(isHeadroomPid(210426, readCmdline)).toBe(false);
  });

  it("is false when the pid is dead (reader throws)", () => {
    const readCmdline = () => {
      throw new Error("ENOENT: no such process");
    };
    expect(isHeadroomPid(999999, readCmdline)).toBe(false);
  });
});

import { decideStartAction } from "../extensions/headroom-lib.ts";

describe("decideStartAction", () => {
  const headroom = (pid: number) => pid === 210426; // only this pid is a real proxy

  it("REUSE when healthy and pidfile points at a live headroom", () => {
    expect(
      decideStartAction({ healthy: true, pidFromFile: 210426, isHeadroom: headroom }),
    ).toEqual({ action: "reuse" });
  });

  it("ADOPT when healthy but pidfile is missing (orphan from older run)", () => {
    expect(
      decideStartAction({ healthy: true, pidFromFile: null, isHeadroom: headroom }),
    ).toEqual({ action: "adopt" });
  });

  it("ADOPT when healthy but pidfile pid is not a headroom process", () => {
    expect(
      decideStartAction({ healthy: true, pidFromFile: 999, isHeadroom: headroom }),
    ).toEqual({ action: "adopt" });
  });

  it("KILL_THEN_SPAWN when unhealthy but pidfile pid is still a headroom proc", () => {
    expect(
      decideStartAction({ healthy: false, pidFromFile: 210426, isHeadroom: headroom }),
    ).toEqual({ action: "kill_then_spawn", killPid: 210426 });
  });

  it("SPAWN when unhealthy and no pidfile", () => {
    expect(
      decideStartAction({ healthy: false, pidFromFile: null, isHeadroom: headroom }),
    ).toEqual({ action: "spawn" });
  });

  it("SPAWN (never kill) when unhealthy and pidfile pid was recycled to a foreign process", () => {
    expect(
      decideStartAction({ healthy: false, pidFromFile: 999, isHeadroom: headroom }),
    ).toEqual({ action: "spawn" });
  });
});

import { decideExitAction } from "../extensions/headroom-lib.ts";

describe("decideExitAction", () => {
  const headroom = (pid: number) => pid === 210426;

  it("LEAVE when other pi processes are still running", () => {
    expect(
      decideExitAction({ otherPiCount: 2, pidFromFile: 210426, isHeadroom: headroom }),
    ).toEqual({ action: "leave" });
  });

  it("REAP when I am the last pi and pidfile points at the live proxy", () => {
    expect(
      decideExitAction({ otherPiCount: 0, pidFromFile: 210426, isHeadroom: headroom }),
    ).toEqual({ action: "reap", killPid: 210426 });
  });

  it("CLEANUP (no kill) when last but pidfile pid was recycled to a foreign process", () => {
    expect(
      decideExitAction({ otherPiCount: 0, pidFromFile: 999, isHeadroom: headroom }),
    ).toEqual({ action: "cleanup" });
  });

  it("CLEANUP when last and no pidfile", () => {
    expect(
      decideExitAction({ otherPiCount: 0, pidFromFile: null, isHeadroom: headroom }),
    ).toEqual({ action: "cleanup" });
  });
});

import { shouldReapOnShutdown, parsePidFromSs } from "../extensions/headroom-lib.ts";

describe("shouldReapOnShutdown (only real process quit reaps)", () => {
  it("reaps on quit", () => {
    expect(shouldReapOnShutdown("quit")).toBe(true);
  });
  it.each(["resume", "new", "fork", "reload"] as const)(
    "does NOT reap on %s (session swap / reload, process stays)",
    (reason) => {
      expect(shouldReapOnShutdown(reason)).toBe(false);
    },
  );
});

describe("parsePidFromSs (adopt-orphan pid discovery)", () => {
  it("extracts the listener pid from an ss -tlnp line", () => {
    const out =
      'LISTEN 0 2048 127.0.0.1:8787 0.0.0.0:* users:(("headroom",pid=210426,fd=7))';
    expect(parsePidFromSs(out)).toBe(210426);
  });
  it("returns null when no pid is present", () => {
    expect(parsePidFromSs("LISTEN 0 2048 127.0.0.1:8787 0.0.0.0:*")).toBeNull();
  });
  it("returns null for empty output", () => {
    expect(parsePidFromSs("")).toBeNull();
  });
});
