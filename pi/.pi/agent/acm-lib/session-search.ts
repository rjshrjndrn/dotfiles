/**
 * Session Search — Tier 3 recall from raw JSONL session files.
 *
 * Pipeline: rg --json grep → parse JSONL lines → BM25-lite score → rank → top-K
 *
 * Scoring: tf_saturated × length_norm × role_weight × tool_weight × recency
 */
import { execSync } from "child_process";

// ─── Config ───

const K1 = 1.5;
const B = 0.75;
const AVG_LEN = 200;

const ROLE_WEIGHT: Record<string, number> = {
  user: 3.0,
  assistant: 1.5,
  toolResult: 1.0,
};

const TOOL_WEIGHT: Record<string, number> = {
  bash: 2.0,
  edit: 1.5,
  write: 1.5,
  read: 1.0,
  web_fetch: 0.5,
  mcp: 0.5,
};

// ─── Types ───

export interface ParsedMessage {
  id: string;
  role: string;
  toolName: string;
  content: string;
  ts: string;
}

export interface RgMatch {
  filePath: string;
  lineNo: number;
  text: string;
}

export interface SessionHit {
  id: string;
  role: string;
  toolName: string;
  content: string; // truncated snippet
  ts: string;
  score: number;
  filePath: string;
  lineNo: number;
}

export interface SearchResult {
  hits: SessionHit[];
  total: number;
  timings: { rg: number; total: number };
}

// ─── parseJsonlLine ───

export function parseJsonlLine(line: string): ParsedMessage | null {
  try {
    const obj = JSON.parse(line);
    if (obj.type !== "message") return null;
    const msg = obj.message;
    if (!msg) return null;

    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join(" ");
    }

    if (!content) return null;

    return {
      id: obj.id || "",
      role: msg.role || "",
      toolName: msg.toolName || "",
      content,
      ts: obj.timestamp || "",
    };
  } catch {
    return null;
  }
}

// ─── scoreHit ───

export function scoreHit(
  query: string,
  content: string,
  role: string,
  toolName: string,
  hitTs: number,
  now: number,
): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const contentLower = content.toLowerCase();
  const contentLen = content.length;

  let tfScore = 0;
  for (const term of terms) {
    let tf = 0;
    let idx = 0;
    while ((idx = contentLower.indexOf(term, idx)) !== -1) {
      tf++;
      idx += term.length;
    }
    if (tf === 0) continue;
    const tfSat = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * contentLen / AVG_LEN));
    tfScore += tfSat;
  }

  if (tfScore === 0) return 0;

  const rw = ROLE_WEIGHT[role] ?? 1.0;
  const tw = TOOL_WEIGHT[toolName] || 1.0;

  const ageDays = (now - hitTs) / (1000 * 60 * 60 * 24);
  const recency = Math.exp(-ageDays / 30);

  return tfScore * rw * tw * recency;
}

// ─── parseRgOutput ───

export function parseRgOutput(stdout: string): RgMatch[] {
  if (!stdout) return [];
  const matches: RgMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type !== "match") continue;
      matches.push({
        filePath: ev.data.path?.text || "",
        lineNo: ev.data.line_number,
        text: ev.data.lines?.text || "",
      });
    } catch {}
  }
  return matches;
}

// ─── searchSessions ───

export async function searchSessions(
  query: string,
  sessionPath: string,
  opts?: { maxResults?: number },
): Promise<SearchResult> {
  const maxResults = opts?.maxResults ?? 5;
  const now = Date.now();
  const t0 = performance.now();

  // Step 1: rg grep (OR terms for broad retrieval, scoring handles ranking)
  const terms = query.split(/\s+/).filter(Boolean);
  const rgPattern = terms.length > 1
    ? terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    : query;
  let rgOutput = "";
  try {
    rgOutput = execSync(
      `rg --json -i -e ${JSON.stringify(rgPattern)} ${JSON.stringify(sessionPath)}`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
    );
  } catch (e: any) {
    rgOutput = e.stdout || "";
  }
  const rgTime = performance.now() - t0;

  // Step 2: Parse rg output
  const rgMatches = parseRgOutput(rgOutput);

  // Step 3: Parse + score each match
  const hits: SessionHit[] = [];
  for (const m of rgMatches) {
    const parsed = parseJsonlLine(m.text.replace(/\n$/, ""));
    if (!parsed) continue;

    const hitTs = parsed.ts ? new Date(parsed.ts).getTime() : now;
    const s = scoreHit(query, parsed.content, parsed.role, parsed.toolName, hitTs, now);
    if (s === 0) continue;

    hits.push({
      id: parsed.id,
      role: parsed.role,
      toolName: parsed.toolName,
      content: parsed.content.slice(0, 150),
      ts: parsed.ts,
      score: s,
      filePath: m.filePath,
      lineNo: m.lineNo,
    });
  }

  // Step 4: Sort + top-K
  hits.sort((a, b) => b.score - a.score);

  return {
    hits: hits.slice(0, maxResults),
    total: rgMatches.length,
    timings: { rg: rgTime, total: performance.now() - t0 },
  };
}
