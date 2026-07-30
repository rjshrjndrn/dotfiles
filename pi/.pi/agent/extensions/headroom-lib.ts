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

export type StartAction =
  | { action: "reuse" }
  | { action: "adopt" }
  | { action: "spawn" }
  | { action: "kill_then_spawn"; killPid: number };

/**
 * Decide what a starting session should do about the shared proxy.
 * Pure: caller performs the side effect (reuse/adopt/spawn/kill).
 * `healthy` = probe of the proxy port; `pidFromFile` + `isHeadroom` locate
 * and validate the owning process (guarding against PID recycling).
 */
export function decideStartAction(input: {
  healthy: boolean;
  pidFromFile: number | null;
  isHeadroom: (pid: number) => boolean;
}): StartAction {
  const { healthy, pidFromFile, isHeadroom } = input;
  const pidValid = pidFromFile != null && isHeadroom(pidFromFile);

  if (healthy) return pidValid ? { action: "reuse" } : { action: "adopt" };
  if (pidValid) return { action: "kill_then_spawn", killPid: pidFromFile! };
  return { action: "spawn" };
}

export type ExitAction =
  | { action: "leave" }
  | { action: "cleanup" }
  | { action: "reap"; killPid: number };

/**
 * Decide what a quitting session should do about the shared proxy.
 * Only the last pi process reaps it; a recycled/dead pid is cleaned up
 * (pidfile removed) but never signalled.
 */
export function decideExitAction(input: {
  otherPiCount: number;
  pidFromFile: number | null;
  isHeadroom: (pid: number) => boolean;
}): ExitAction {
  const { otherPiCount, pidFromFile, isHeadroom } = input;
  if (otherPiCount > 0) return { action: "leave" };
  if (pidFromFile != null && isHeadroom(pidFromFile))
    return { action: "reap", killPid: pidFromFile };
  return { action: "cleanup" };
}

export type ShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";

/**
 * The shared proxy is reaped only when the pi *process* is quitting. Session
 * swaps (resume/new/fork) and extension reloads keep the process alive, so the
 * proxy must survive them. This is the fix for the /resume dead-proxy bug.
 */
export function shouldReapOnShutdown(reason: ShutdownReason): boolean {
  return reason === "quit";
}

/** Extract the listening pid from an `ss -tlnp` line, e.g. `pid=210426`. */
export function parsePidFromSs(ssOutput: string): number | null {
  const m = ssOutput.match(/pid=(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}
