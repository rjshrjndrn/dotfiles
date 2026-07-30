// Pure lifecycle helpers for the headroom shared-proxy extension.
// No pi SDK deps -> unit-testable in isolation.

import { readFileSync, writeFileSync, rmSync } from "node:fs";

/** Read a pid from a pidfile. Returns null if missing or non-numeric. */
export function readPidFile(path: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Write a pid to a pidfile. */
export function writePidFile(path: string, pid: number): void {
  writeFileSync(path, `${pid}\n`, "utf8");
}

/** Delete a pidfile. No-op if it does not exist. */
export function removePidFile(path: string): void {
  rmSync(path, { force: true });
}

/** Default cmdline reader: /proc/<pid>/cmdline (NUL-separated). */
function defaultReadCmdline(pid: number): string {
  return readFileSync(`/proc/${pid}/cmdline`, "utf8");
}

/**
 * Guard against PID recycling: confirm `pid` is actually a headroom process
 * before we ever signal it. Returns false if the pid is dead or unrelated.
 */
export function isHeadroomPid(
  pid: number,
  readCmdline: (pid: number) => string = defaultReadCmdline,
): boolean {
  try {
    const cmdline = readCmdline(pid).replace(/\0/g, " ");
    return cmdline.includes("headroom");
  } catch {
    return false;
  }
}
