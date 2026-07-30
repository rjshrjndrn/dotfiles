/**
 * Headroom Extension — transparent context compression for pi.
 *
 * Spawns a local headroom proxy on session start, overrides the Anthropic
 * provider baseUrl to route all LLM traffic through it, and tears down the
 * proxy on session shutdown.
 *
 * Prerequisites:
 *   pip install "headroom-ai[proxy]"
 *
 * Configuration (env vars):
 *   HEADROOM_PORT        — proxy port (default: 8787)
 *   HEADROOM_WORKERS     — uvicorn worker processes (default: 4)
 *   HEADROOM_DISABLED    — set to "1" to skip proxy startup
 *   HEADROOM_LOG_FILE    — path for proxy request log (optional)
 *   HEADROOM_EXTRA_ARGS  — additional CLI args for headroom proxy (optional)
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { openSync, closeSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  readPidFile,
  writePidFile,
  removePidFile,
  isHeadroomPid,
  decideStartAction,
  decideExitAction,
  shouldReapOnShutdown,
  parsePidFromSs,
  type ShutdownReason,
} from "./headroom-lib.ts";

const DEFAULT_LOG_FILE = "/tmp/headroom.log";

// Cross-process source of truth for the shared proxy's pid, so any session can
// discover, reuse, or reap it regardless of which session spawned it.
const PIDFILE = join(homedir(), ".cache", "pi", "headroom.pid");

const DEFAULT_PORT = 8787;
const HEALTH_POLL_MS = 200;

// Output shaper: trims ceremony/restated code from model responses.
// Override with env HEADROOM_OUTPUT_SHAPER=0 to disable.
const OUTPUT_SHAPER_ENABLED = "1";

export default function (pi: ExtensionAPI) {
  let proxyProcess: ChildProcess | null = null;
  let proxyPort: number = DEFAULT_PORT;
  let sessionGeneration = 0;  // bumped on each session_start, stale callbacks check this

  // Register /headroom command to check status and stats
  pi.registerCommand("headroom", {
    description: "Show headroom proxy status and compression savings",
    async handler(_args, ctx) {
      try {
        const [healthRes, statsRes] = await Promise.all([
          fetch(`http://127.0.0.1:${proxyPort}/health`, { signal: AbortSignal.timeout(2000) }),
          fetch(`http://127.0.0.1:${proxyPort}/stats`, { signal: AbortSignal.timeout(2000) }),
        ]);

        if (!healthRes.ok) {
          ctx.ui.notify(`Headroom proxy returned ${healthRes.status}`, "warning");
          return;
        }

        const health = await healthRes.json().catch(() => ({}));
        const stats = await statsRes.json().catch(() => ({}));
        const owned = proxyProcess && !proxyProcess.killed ? "spawned" : "reused";

        const t = stats.tokens ?? {};
        const c = stats.cost ?? {};
        const l = stats.latency ?? {};
        const s = stats.summary ?? {};
        const comp = s.compression ?? {};

        const lines = [
          `⚡ Headroom v${health.version ?? "?"} (${owned}) · port ${proxyPort} · uptime ${formatUptime(health.uptime_seconds)}`,
          ``,
          `Tokens   ${fmtNum(t.saved ?? 0)} saved / ${fmtNum(t.input ?? 0)} input (${(t.savings_percent ?? 0).toFixed(1)}%)`,
          `Cost     $${(c.cost_with_headroom_usd ?? 0).toFixed(2)} with · $${((c.cost_with_headroom_usd ?? 0) + (c.compression_savings_usd ?? 0)).toFixed(2)} without · saved $${(c.compression_savings_usd ?? 0).toFixed(2)}`,
          `Cache    ${(stats.prefix_cache?.totals?.request_hit_rate ?? 0).toFixed(0)}% hit rate · saved $${(stats.prefix_cache?.totals?.net_savings_usd ?? 0).toFixed(2)}`,
          `Reqs     ${s.api_requests ?? 0} total · ${comp.requests_compressed ?? 0} compressed · best ${comp.best_compression_pct ?? 0}%`,
          `Latency  avg ${(l.average_ms ?? 0).toFixed(0)}ms · overhead avg ${(stats.overhead?.average_ms ?? 0).toFixed(0)}ms`,
        ];

        ctx.ui.notify(lines.join("\n"), "info");
      } catch {
        ctx.ui.notify("Headroom proxy is not running", "warning");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (process.env.HEADROOM_DISABLED === "1") return;

    const gen = ++sessionGeneration;  // capture generation for this session
    proxyPort = parseInt(process.env.HEADROOM_PORT || String(DEFAULT_PORT), 10);

    // Decide what to do about the shared proxy: reuse a live one, adopt an
    // orphan whose pidfile is stale, kill a hung proxy, or spawn fresh.
    const healthy = await isProxyHealthy(proxyPort);
    const action = decideStartAction({
      healthy,
      pidFromFile: readPidFile(PIDFILE),
      isHeadroom: (p) => isHeadroomPid(p),
    });

    if (action.action === "reuse") {
      overrideProvider();
      ctx.ui.setStatus("headroom", "⚡ headroom (reused)");
      return;
    }

    if (action.action === "adopt") {
      // Healthy proxy but no owning pidfile (orphan from an older run) — record
      // its pid so the last session out can still reap it.
      const discovered = discoverProxyPid(proxyPort);
      if (discovered) persistPid(discovered);
      overrideProvider();
      ctx.ui.setStatus("headroom", "⚡ headroom (reused)");
      return;
    }

    if (action.action === "kill_then_spawn") {
      killByPid(action.killPid); // guarded: only signals a real headroom pid
      removePidFile(PIDFILE);
    }

    // Check if headroom CLI is available
    const headroomPath = await findHeadroom();
    if (!headroomPath) {
      ctx.ui.notify(
        'Headroom not installed. Run: uv tool install "headroom-ai[all]"',
        "warning",
      );
      return;
    }

    // Build proxy args with optimal defaults for pi
    const args = [
      "proxy",
      "--port", String(proxyPort),
      "--mode", "token",                // compress prior turns for max token savings
      "--code-aware",                    // AST-based code compression
      "--intercept-tool-results",        // compress Read/bash tool results
      "--no-telemetry",
      "--lossless",                      // no CCR retrieve tool -> avoids buffered->SSE reconvert 502
      "--workers", process.env.HEADROOM_WORKERS ?? "4",  // multiple agents share proxy -> parallel uvicorn workers so one compress doesn't block others
      "--embedding-server",              // shared ONNX/HNSW sidecar across workers (avoids N x ~600MB model load)
      "--no-rate-limit",                 // per-proxy rpm/tpm bucket is shared across all agents; let Anthropic enforce limits instead
    ];
    if (process.env.HEADROOM_LOG_FILE) {
      args.push("--log-file", process.env.HEADROOM_LOG_FILE);
    }
    if (process.env.HEADROOM_EXTRA_ARGS) {
      args.push(...process.env.HEADROOM_EXTRA_ARGS.split(" ").filter(Boolean));
    }

    // Spawn the proxy — log output to file instead of TUI
    const logFile = process.env.HEADROOM_LOG_FILE_EXT || DEFAULT_LOG_FILE;
    const logFd = openSync(logFile, "a");
    const timestamp = new Date().toISOString();
    appendFileSync(logFd, `\n--- headroom proxy started at ${timestamp} ---\n`);

    proxyProcess = spawn(headroomPath, args, {
      stdio: ["ignore", logFd, logFd],
      detached: true, // own process group -> survives this session's exit until explicitly reaped
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        HEADROOM_OUTPUT_SHAPER: process.env.HEADROOM_OUTPUT_SHAPER ?? OUTPUT_SHAPER_ENABLED,
      },
    });
    proxyProcess.unref(); // don't keep this process alive on the proxy's behalf

    // Close fd in parent — child inherited it
    closeSync(logFd);

    proxyProcess.on("error", () => {
      proxyProcess = null;
    });

    proxyProcess.on("exit", () => {
      proxyProcess = null;
    });

    // Override provider immediately — proxy will be ready before user finishes typing.
    // Non-blocking: don't await full startup.
    overrideProvider();
    ctx.ui.setStatus("headroom", "⚡ headroom (starting…)");

    // Background: confirm proxy is healthy, update status.
    // If session is replaced before proxy is ready, gen will mismatch → skip stale update.
    waitForProxy(proxyPort, 15_000).then((ready) => {
      if (gen !== sessionGeneration) return;  // session was replaced, new one handles it
      try {
        if (ready) {
          // Record the actual port listener (the proxy may re-exec on startup).
          // Written only after health passes, so a losing double-spawn converges
          // on the winner's pid instead of clobbering the pidfile with a dead one.
          const discovered = discoverProxyPid(proxyPort) ?? proxyProcess?.pid ?? null;
          if (discovered) persistPid(discovered);
          ctx.ui.setStatus("headroom", "⚡ headroom");
        } else {
          ctx.ui.setStatus("headroom", "⚠ headroom (failed)");
          ctx.ui.notify("Headroom proxy failed to start", "error");
          killProxy();
          pi.unregisterProvider("anthropic");
        }
      } catch {
        // ctx went stale (session replaced/reloaded between gen check and ui access) — safe to ignore
      }
    });
  });

  pi.on("session_shutdown", async (event) => {
    // Survive in-process session swaps (resume/new/fork) and extension reloads.
    // Only a real process quit reaps the shared proxy.
    if (!shouldReapOnShutdown(event.reason as ShutdownReason)) return;

    const total = await countPiProcesses();
    const otherPiCount = Math.max(0, total - 1); // self is still alive here
    const action = decideExitAction({
      otherPiCount,
      pidFromFile: readPidFile(PIDFILE),
      isHeadroom: (p) => isHeadroomPid(p),
    });

    if (action.action === "leave") return;
    if (action.action === "reap") killByPid(action.killPid);
    removePidFile(PIDFILE); // reap and cleanup both clear the stale pidfile
  });

  function overrideProvider() {
    pi.registerProvider("anthropic", {
      baseUrl: `http://127.0.0.1:${proxyPort}`,
    });
  }

  function killProxy() {
    if (proxyProcess && !proxyProcess.killed) {
      proxyProcess.kill("SIGTERM");
      // Give it a moment, then force kill
      setTimeout(() => {
        if (proxyProcess && !proxyProcess.killed) {
          proxyProcess.kill("SIGKILL");
        }
        proxyProcess = null;
      }, 2000);
    }
  }
}

async function isProxyHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForProxy(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isProxyHealthy(port)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

async function findHeadroom(): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    const path = execSync("which headroom", { encoding: "utf8" }).trim();
    return path || null;
  } catch {
    return null;
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUptime(seconds?: number): string {
  if (!seconds) return "?";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

async function countPiProcesses(): Promise<number> {
  try {
    const { execSync } = await import("node:child_process");
    // Match pi's process title (set via process.title in cli entry)
    const output = execSync(
      "ps -eo pid,comm | awk '$2 == \"pi\" { count++ } END { print count+0 }'",
      { encoding: "utf8", timeout: 2000 },
    ).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

/** Write the proxy pid to the shared pidfile, creating the cache dir as needed. */
function persistPid(pid: number): void {
  try {
    mkdirSync(join(homedir(), ".cache", "pi"), { recursive: true });
    writePidFile(PIDFILE, pid);
  } catch {
    // pidfile is best-effort; reaping degrades to leaving an orphan, not a crash
  }
}

/** Find the pid listening on the proxy port (used to adopt an orphaned proxy). */
function discoverProxyPid(port: number): number | null {
  try {
    const out = execSync(`ss -tlnpH 'sport = :${port}'`, {
      encoding: "utf8",
      timeout: 2000,
    });
    return parsePidFromSs(out);
  } catch {
    return null;
  }
}

/** SIGTERM a pid, but only if it is genuinely a headroom process (recycling guard). */
function killByPid(pid: number): void {
  if (!isHeadroomPid(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}
