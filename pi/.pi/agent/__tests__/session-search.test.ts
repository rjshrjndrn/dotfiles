import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import {
  parseJsonlLine,
  scoreHit,
  parseRgOutput,
  searchSessions,
  type SessionHit,
  type ParsedMessage,
} from "../acm-lib/session-search.ts";

/**
 * Session Search Behavior Tests
 *
 * Pipeline: rg grep → parse JSONL → BM25-lite score → rank → top-K
 *
 * 1. parseJsonlLine extracts role/tool/content/timestamp from JSONL
 * 2. scoreHit ranks by tf saturation × length norm × role × tool × recency
 * 3. parseRgOutput extracts match lines from rg --json stdout
 * 4. searchSessions orchestrates full pipeline, returns top-K
 * 5. User messages rank above toolResult noise for same query
 */

// ─── Fixtures ───

const userMsg = (text: string, ts = "2026-07-10T12:00:00.000Z") =>
  JSON.stringify({
    type: "message",
    id: "u1",
    parentId: "p1",
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text }] },
  });

const assistantMsg = (text: string, ts = "2026-07-10T12:00:01.000Z") =>
  JSON.stringify({
    type: "message",
    id: "a1",
    parentId: "u1",
    timestamp: ts,
    message: { role: "assistant", content: text },
  });

const toolResultMsg = (text: string, toolName: string, ts = "2026-07-10T12:00:02.000Z") =>
  JSON.stringify({
    type: "message",
    id: "t1",
    parentId: "a1",
    timestamp: ts,
    message: { role: "toolResult", toolName, content: [{ type: "text", text }] },
  });

const sessionHeader = JSON.stringify({
  type: "session",
  version: 3,
  id: "test-session",
  timestamp: "2026-07-10T12:00:00.000Z",
  cwd: "/tmp/test",
});

// ─── 1. parseJsonlLine ───

describe("parseJsonlLine", () => {
  it("extracts role/content/timestamp from user message with array content", () => {
    const result = parseJsonlLine(userMsg("ssh azureuser@10.55.1.4"));
    expect(result).not.toBeNull();
    expect(result!.role).toBe("user");
    expect(result!.content).toBe("ssh azureuser@10.55.1.4");
    expect(result!.ts).toBe("2026-07-10T12:00:00.000Z");
    expect(result!.toolName).toBe("");
  });

  it("extracts content from assistant message with string content", () => {
    const result = parseJsonlLine(assistantMsg("No SSH config found"));
    expect(result!.role).toBe("assistant");
    expect(result!.content).toBe("No SSH config found");
  });

  it("extracts toolName from toolResult", () => {
    const result = parseJsonlLine(toolResultMsg("command output here", "bash"));
    expect(result!.role).toBe("toolResult");
    expect(result!.toolName).toBe("bash");
  });

  it("returns null for non-message types", () => {
    expect(parseJsonlLine(sessionHeader)).toBeNull();
  });

  it("returns null for empty content", () => {
    const msg = JSON.stringify({
      type: "message",
      id: "x",
      timestamp: "2026-07-10T12:00:00.000Z",
      message: { role: "user", content: [] },
    });
    expect(parseJsonlLine(msg)).toBeNull();
  });

  it("handles malformed JSON gracefully", () => {
    expect(parseJsonlLine("{broken")).toBeNull();
    expect(parseJsonlLine("")).toBeNull();
  });
});

// ─── 2. scoreHit ───

describe("scoreHit", () => {
  const now = new Date("2026-07-10T12:00:00.000Z").getTime();

  it("user message scores higher than toolResult for same content", () => {
    const userScore = scoreHit("ssh", "ssh azureuser@10.55.1.4", "user", "", now, now);
    const toolScore = scoreHit("ssh", "ssh azureuser@10.55.1.4", "toolResult", "web_fetch", now, now);
    expect(userScore).toBeGreaterThan(toolScore);
  });

  it("short focused content scores higher than long diluted content", () => {
    const short = scoreHit("ssh", "ssh azureuser@10.55.1.4", "user", "", now, now);
    const long = scoreHit("ssh", "x ".repeat(200) + "ssh" + " x".repeat(200), "user", "", now, now);
    expect(short).toBeGreaterThan(long);
  });

  it("bash toolResult scores higher than web_fetch toolResult", () => {
    const bash = scoreHit("ssh", "ssh connection established", "toolResult", "bash", now, now);
    const web = scoreHit("ssh", "ssh connection established", "toolResult", "web_fetch", now, now);
    expect(bash).toBeGreaterThan(web);
  });

  it("recent hit scores higher than old hit", () => {
    const recent = scoreHit("ssh", "ssh config", "user", "", now, now);
    const old = scoreHit("ssh", "ssh config", "user", "", now - 60 * 24 * 60 * 60 * 1000, now);
    expect(recent).toBeGreaterThan(old);
  });

  it("multiple term matches score higher", () => {
    const one = scoreHit("ssh config", "ssh azureuser@host", "user", "", now, now);
    const two = scoreHit("ssh config", "ssh config for prod server", "user", "", now, now);
    expect(two).toBeGreaterThan(one);
  });

  it("returns 0 for no matches", () => {
    expect(scoreHit("ssh", "docker compose up", "user", "", now, now)).toBe(0);
  });
});

// ─── 3. parseRgOutput ───

describe("parseRgOutput", () => {
  it("extracts match events from rg --json output", () => {
    const rgOutput = [
      JSON.stringify({ type: "begin", data: { path: { text: "/tmp/test.jsonl" } } }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/tmp/test.jsonl" },
          line_number: 42,
          lines: { text: userMsg("ssh azureuser@host") + "\n" },
        },
      }),
      JSON.stringify({ type: "end", data: { path: { text: "/tmp/test.jsonl" } } }),
    ].join("\n");

    const matches = parseRgOutput(rgOutput);
    expect(matches).toHaveLength(1);
    expect(matches[0].lineNo).toBe(42);
    expect(matches[0].filePath).toBe("/tmp/test.jsonl");
    expect(matches[0].text).toContain("ssh azureuser@host");
  });

  it("skips non-match events", () => {
    const rgOutput = [
      JSON.stringify({ type: "begin", data: {} }),
      JSON.stringify({ type: "summary", data: {} }),
    ].join("\n");
    expect(parseRgOutput(rgOutput)).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(parseRgOutput("")).toHaveLength(0);
  });
});

// ─── 4. searchSessions (end-to-end) ───

describe("searchSessions", () => {
  let tmpDir: string;
  let sessionFile: string;

  beforeAll(() => {
    tmpDir = mkdtempSync("/tmp/session-search-test-");
    sessionFile = join(tmpDir, "test-session.jsonl");

    // Build a realistic session file
    const lines = [
      sessionHeader,
      // User gives SSH creds (GOLD - should rank #1)
      userMsg("ssh azureuser@10.55.1.4 -i ~/.cred/dev-ssh-key.pem"),
      // Assistant acknowledges
      assistantMsg("Connecting via SSH to the remote machine."),
      // toolResult with SSH in noise (loghub dataset)
      toolResultMsg(
        "GitHub: logpai/loghub SSH dataset. OpenSSH_2k.log contains 2000 SSH log entries from " +
          "a Linux server. Columns: LineId, Content, EventId. This dataset includes authentication " +
          "failures, session opened/closed events, and connection reset messages for SSH daemon.",
        "web_fetch",
      ),
      // Another toolResult - bash with SSH
      toolResultMsg("Last login: Thu Jun 26 via ssh\nazureuser@prod-vm:~$", "bash"),
      // User asks about docker (no ssh)
      userMsg("check docker containers"),
      // User mentions SSH again briefly
      userMsg("ignore ssh host key check"),
    ];
    writeFileSync(sessionFile, lines.join("\n") + "\n");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("returns results ranked by score", async () => {
    const results = await searchSessions("ssh", sessionFile);
    expect(results.hits.length).toBeGreaterThan(0);

    // Verify sorted descending
    for (let i = 1; i < results.hits.length; i++) {
      expect(results.hits[i - 1].score).toBeGreaterThanOrEqual(results.hits[i].score);
    }
  });

  it("ranks user SSH command above loghub noise", async () => {
    const results = await searchSessions("ssh", sessionFile);
    const top = results.hits[0];
    expect(top.role).toBe("user");
    expect(top.content).toContain("azureuser@10.55.1.4");
  });

  it("loghub web_fetch result ranks last among SSH hits", async () => {
    const results = await searchSessions("ssh", sessionFile);
    const webFetchHits = results.hits.filter((h) => h.toolName === "web_fetch");
    expect(webFetchHits.length).toBe(1);

    const webFetchIdx = results.hits.indexOf(webFetchHits[0]);
    expect(webFetchIdx).toBe(results.hits.length - 1);
  });

  it("respects maxResults", async () => {
    const results = await searchSessions("ssh", sessionFile, { maxResults: 2 });
    expect(results.hits.length).toBeLessThanOrEqual(2);
  });

  it("returns empty for no matches", async () => {
    const results = await searchSessions("kubernetes", sessionFile);
    expect(results.hits).toHaveLength(0);
  });

  it("reports timing stats", async () => {
    const results = await searchSessions("ssh", sessionFile);
    expect(results.timings.rg).toBeGreaterThan(0);
    expect(results.timings.total).toBeGreaterThan(0);
  });

  it("includes file path and line number for each hit", async () => {
    const results = await searchSessions("ssh", sessionFile);
    for (const hit of results.hits) {
      expect(hit.filePath).toBe(sessionFile);
      expect(hit.lineNo).toBeGreaterThan(0);
    }
  });

  it("truncates content snippet to ~150 chars", async () => {
    const results = await searchSessions("ssh", sessionFile);
    for (const hit of results.hits) {
      expect(hit.content.length).toBeLessThanOrEqual(160);
    }
  });
});

// ─── 5. Real session file (integration) ───

describe("real session search", () => {
  const REAL_SESSION =
    "/Users/skynet/.pi/agent/sessions/--Users-skynet-Documents-projects-personal-harkx-worktree-vector--/2026-06-27T02-15-59-057Z_019f06dc-c351-7072-9674-332ec37fed0f.jsonl";

  it("ranks user SSH command #1 from 382 rg matches", async () => {
    const results = await searchSessions("ssh", REAL_SESSION, { maxResults: 5 });
    expect(results.hits[0].role).toBe("user");
    expect(results.hits[0].content).toContain("azureuser@10.55.1.4");
  });

  it("completes in under 1 second", async () => {
    const results = await searchSessions("ssh", REAL_SESSION);
    expect(results.timings.total).toBeLessThan(1000);
  });
});
