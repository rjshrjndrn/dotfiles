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
