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
 *   HEADROOM_DISABLED    — set to "1" to skip proxy startup
 *   HEADROOM_LOG_FILE    — path for proxy request log (optional)
 *   HEADROOM_EXTRA_ARGS  — additional CLI args for headroom proxy (optional)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync, appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_LOG_FILE = "/tmp/headroom.log";

const DEFAULT_PORT = 8787;
const HEALTH_POLL_MS = 200;

export default function (pi: ExtensionAPI) {
  let proxyProcess: ChildProcess | null = null;
  let proxyPort: number = DEFAULT_PORT;

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

    proxyPort = parseInt(process.env.HEADROOM_PORT || String(DEFAULT_PORT), 10);

    // Fast path: proxy already running (another session, external start, or persistent service)
    if (await isProxyHealthy(proxyPort)) {
      overrideProvider();
      ctx.ui.setStatus("headroom", "⚡ headroom (reused)");
      return;
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
      "--memory",                        // persistent cross-session memory
      "--memory-storage", "user",        // single DB per user (proxy cwd != project cwd)
      "--no-subscription-tracking",      // pi doesn't use Claude Code subscription
      "--no-telemetry",
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
      detached: false,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    });

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

    // Background: confirm proxy is healthy, update status
    waitForProxy(proxyPort, 15_000).then((ready) => {
      if (ready) {
        ctx.ui.setStatus("headroom", "⚡ headroom");
      } else {
        ctx.ui.setStatus("headroom", "⚠ headroom (failed)");
        ctx.ui.notify("Headroom proxy failed to start", "error");
        killProxy();
        // Remove override so requests go direct to Anthropic
        pi.unregisterProvider("anthropic");
      }
    });
  });

  pi.on("session_shutdown", async () => {
    // Only kill proxy we spawned, and only if no other pi sessions are using it
    if (!proxyProcess || proxyProcess.killed) return;
    const otherPiSessions = await countPiProcesses();
    if (otherPiSessions <= 1) {
      killProxy();
    }
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
