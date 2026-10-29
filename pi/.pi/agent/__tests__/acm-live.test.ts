/**
 * Live end-to-end: drives the real pi binary (json mode) with the ACM
 * extension against a real model. Costs API calls, so opt-in:
 *
 *   ACM_LIVE=1 npx vitest run __tests__/acm-live.test.ts
 *
 * Each scenario is a fresh session in a temp dir, so it never depends on
 * a hand-picked session file that may get deleted.
 */
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchSessions } from "../acm-lib/session-search.ts";

const run = promisify(execFile);
const ACM = join(import.meta.dirname, "../extensions/acm.ts");
const MODEL = process.env.ACM_LIVE_MODEL ?? "anthropic/claude-haiku-4-5";
const MARKER = "PINEAPPLE-42";

/** A pi session in a temp dir; each say() is one `pi -p` run on the same session file. */
function liveSession() {
  const dir = mkdtempSync(join(tmpdir(), "acm-live-"));
  let session: string | undefined;
  return {
    get file() { return session!; },
    async say(prompt: string): Promise<{ text: string; tools: string[] }> {
      const args = [
        "-p", "--mode", "json", "--no-extensions", "-e", ACM, "--no-mcp", "--no-skills",
        "--session-dir", dir, "--model", MODEL, "--thinking", "off",
        "--tools", "bash,acm_map,acm_pin,acm_slide,acm_recall",
        ...(session ? ["--session", session] : []), prompt,
      ];
      const pending = run("pi", args, { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 });
      pending.child.stdin?.end(); // pi -p reads piped stdin until EOF
      const { stdout } = await pending;
      session ??= join(dir, readdirSync(dir).find((f) => f.endsWith(".jsonl"))!);
      const events = stdout.trim().split("\n").map((l) => JSON.parse(l));
      const end = events.find((e) => e.type === "agent_end");
      const last = end?.messages?.at(-1);
      const text = (last?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      const tools = events.filter((e) => e.type === "tool_execution_end").map((e) => e.toolName);
      return { text, tools };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const ASK = "Do not call any tools. What exact marker did the very first bash command print? Reply with only the marker, or UNKNOWN.";

describe.skipIf(!process.env.ACM_LIVE).concurrent("acm live (real pi + model)", () => {
  it("pinned tool result survives a slide; unpinned control does not", async () => {
    const pinned = liveSession();
    const control = liveSession();
    try {
      // Same history for both; only `pinned` pins the marker before sliding.
      // Pin and slide are separate runs so acm_map output (which previews
      // the marker) is itself slid away and cannot leak it.
      await Promise.all([pinned, control].map(async (s) => {
        await s.say(`Run bash: echo ${MARKER}`);
        await s.say("Run bash: echo filler-one");
      }));
      const [p3] = await Promise.all([
        pinned.say(`Call acm_map. Then call acm_pin with action pin on the entry ID of the toolResult that printed ${MARKER}. Reply done.`),
        control.say("Call acm_map. Reply done."),
      ]);
      expect(p3.tools).toContain("acm_pin");
      const slides = await Promise.all([pinned, control].map((s) => s.say("Call acm_slide with keepMessages 1. Reply done.")));
      for (const s of slides) expect(s.tools).toContain("acm_slide");

      const [p, c] = await Promise.all([pinned.say(ASK), control.say(ASK)]);
      expect(p.text).toContain(MARKER);
      expect(c.text).not.toContain(MARKER); // proves the answer came from the pin
    } finally {
      pinned.cleanup();
      control.cleanup();
    }
  }, 300_000);

  it("session search ranks the user's own message above tool noise", async () => {
    const s = liveSession();
    try {
      await s.say(`Run bash: echo ${MARKER}; echo ${MARKER} again`);
      const lines = readFileSync(s.file, "utf8").split("\n").filter((l) => l.includes(MARKER));
      expect(lines.length).toBeGreaterThan(1); // user + toolResult (+ assistant) all match

      const result = await searchSessions(MARKER, s.file);
      expect(result.hits[0].role).toBe("user");
    } finally {
      s.cleanup();
    }
  }, 120_000);
});
