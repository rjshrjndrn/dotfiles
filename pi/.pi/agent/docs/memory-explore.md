# Memory Architecture Exploration

Date: 2026-07-05

## Current State

- LadybugDB: session-scoped graph DB (embedded, single-writer)
- Stores: `ToolResult → FilePath` (References) + `ToolResult → ToolResult` (Follows)
- Recall: keyword search via `acm_recall` → LadybugDB behind the scenes
- LLM never queries graph directly, only through `acm_recall` abstraction
- Slide summary injects file list + cached result count (metadata only)

## Problem

LadybugDB is session-scoped. Knowledge dies with session. Auth refactoring in session A can't inform bug fix in session B.

## Research

### ChromaDB (vector DB)
- Same single-writer limitation — doesn't solve cross-session
- Needs embedding per store = LLM cost
- No relationship traversal (flat similarity search)
- Metadata filtering primitive (no range, no OR, full scan at scale)
- Good at semantic recall ("find things *about* auth" without exact keyword)
- **Verdict:** Complement to graph, not replacement. Add later if keyword recall quality degrades.

### PROJECTMEM (github.com/riponcm/projectmem)
- Append-only JSONL event log, deterministic summary projection
- Typed events: issue → attempt → fix → decision → note
- **Pre-action judgment gate:** `precheck_file(path)` warns before editing files with prior failures. Deterministic, no LLM call.
- **Cross-project gotchas:** `~/.projectmem/global/`, stack-detected (package.json, pyproject.toml), auto-inherited
- **Never delete, flag stale:** memories get staleness warnings, never purged
- Session-start briefing: one-screen "where was I?"
- Explicit capture (agent calls `log_issue()`) vs our implicit capture (auto-record tool results)
- No DB — just JSONL + fold. No semantic search.
- Python MCP server. MIT licensed.

### Mnemon (temporal knowledge graph)
- 4 graphs: temporal, entity, causal, semantic
- LLM-as-supervisor: host LLM decides what matters, no extra inference cost
- Project-scoped default, optional global mode
- Intent-native protocol: remember, link, recall

### Industry consensus (2026)
- Hybrid = production pattern: Graph (structure) + Vector (semantics) joined by canonical IDs
- Every team building agent memory converges on this
- Project-scoped DB is natural boundary (same cwd = shared knowledge)

## Decision

Current approach (LadybugDB + keyword search) = good enough balance of cost vs recall quality. No ChromaDB for now.

## Steal-worthy Ideas

### 1. Cross-project gotchas (from PROJECTMEM)
- `~/.pi/agent/gotchas.jsonl`, append-only, stack-keyed
- Stack detection from package.json / pyproject.toml / go.mod etc
- JSONL append is concurrent-safe (no DB needed)
- Surface at session start if stack matches

### 2. Pre-action file check (from PROJECTMEM)
- Before `edit` tool runs, query LadybugDB for file's history
- Surface prior failed attempts, decisions, context
- Deterministic lookup, no LLM call

### 3. Project-scoped DB (from Mnemon)
- One LadybugDB per project (keyed by cwd/repo root)
- Same codebase sessions share knowledge
- Different repos don't pollute
- Solves cross-session problem within same project

### 4. Typed event classification
- At slide time, classify tool results into decision/issue/fix/note
- Store classifications in global gotchas when cross-project relevant
- More structured than raw ToolResult blobs

## LadybugDB Schema Enrichment

### Current Schema (bare minimum)

```
ToolResult(id, toolName, keyTerms, timestamp)
FilePath(path)
ToolResult -[References]-> FilePath
ToolResult -[Follows]-> ToolResult
```

### Proposed Rich Schema

**Enhanced nodes:**

```
GitRepo(
  root STRING PRIMARY KEY,   -- /Users/skynet/project-x
  name STRING,               -- project-x
  stack STRING               -- detected: typescript, python, go, etc
)

Session(
  id STRING PRIMARY KEY,     -- session identifier
  startTime INT64,
  cwd STRING,
  summary STRING              -- post-slide summary
)

ToolResult(
  id STRING PRIMARY KEY,
  toolName STRING,
  keyTerms STRING,
  eventType STRING,           -- decision | investigation | fix | exploration | error
  success BOOLEAN,            -- did tool call succeed?
  tokensCost INT64,           -- result size (for ROI tracking)
  timestamp INT64
)

FilePath(
  path STRING PRIMARY KEY,
  gitRoot STRING,             -- which repo
  language STRING,            -- inferred from extension
  lastTouched INT64           -- most recent interaction
)

Decision(
  id STRING PRIMARY KEY,
  summary STRING,
  timestamp INT64
)
```

**Enhanced edges:**

```
Session     -[WorksOn]->      GitRepo
ToolResult  -[BelongsTo]->    Session
ToolResult  -[References]->   FilePath      (existing)
ToolResult  -[Follows]->      ToolResult    (existing)
FilePath    -[InRepo]->       GitRepo
Decision    -[MadeIn]->       Session
Decision    -[SupersededBy]-> Decision
Decision    -[Touches]->      FilePath
```

### Unlocked Queries

- "What decisions were made about this file across all sessions?"
- "What failed attempts happened in this repo?"
- "Show me all sessions that touched auth files"
- "What's the history of this file across sessions?"
- "Which files have the most churn across sessions?" (hot files)
- "What stack does this project use?" (auto-detected)

### Event Type Classification

Infer `eventType` from tool call context:
- `decision` — edit to config, architecture files, or explicit user decision
- `investigation` — grep, find, read (exploring codebase)
- `fix` — edit after a failed test/build
- `exploration` — bash ls, file reads during onboarding
- `error` — tool call that returned error/failure

### Migration Strategy

- New fields added as nullable — existing data keeps working
- `eventType` defaults to "investigation" (most common)
- `gitRoot` detected at insert time via `git rev-parse --show-toplevel`
- `language` inferred from file extension at insert time
- Backfill not needed — old session DBs are throwaway anyway

## Architecture: Session LadybugDB + Project JSONL

### Two-layer design

```
┌─────────────────────────────────────────────────┐
│  Session (hot, ephemeral)                       │
│  ┌───────────────┐                              │
│  │  LadybugDB    │  Full graph: nodes, edges,   │
│  │  session.lbug │  traversal, temporal sequence │
│  └───────┬───────┘                              │
│          │ flush durable events at slide/end    │
├──────────┼──────────────────────────────────────┤
│  Project (durable, cross-session)               │
│          ▼                                      │
│  ┌───────────────┐                              │
│  │  events.jsonl │  Append-only, concurrent-safe │
│  │  per git root │  Searchable archive           │
│  └───────────────┘                              │
└─────────────────────────────────────────────────┘
```

### How LadybugDB complements JSONL

LadybugDB is the **session-scoped graph engine**. JSONL is the **cross-session durable log**.
They serve different purposes:

| Capability | LadybugDB (session) | events.jsonl (project) |
|---|---|---|
| Graph traversal | ✅ "what else touched this file?" | ❌ flat log |
| Temporal sequence | ✅ Follows edges | ❌ ordered by time only |
| Relationship queries | ✅ Cypher / pattern matching | ❌ grep |
| Cross-session recall | ❌ dies with session | ✅ persists forever |
| Concurrent access | ❌ single writer | ✅ append-only safe |
| Rich querying | ✅ multi-hop, joins | ❌ keyword search only |

LadybugDB enables queries JSONL can't:
- "Show me all tool results that touched files related to auth" (multi-hop)
- "What was the investigation sequence before this fix?" (Follows chain)
- "Which files are always edited together?" (co-occurrence via References)

JSONL enables what LadybugDB can't:
- Cross-session persistence without concurrent write issues
- Simple append from any process
- Portable, human-readable, git-friendly

### Session start → hydrate from JSONL

At session start, load relevant events from JSONL into session LadybugDB:
- Only events matching current git root
- Only decisions + unresolved errors + hot files
- Gives session DB cross-session awareness via graph
- Small subset, not full JSONL dump

### Write policy — what goes into events.jsonl

Not everything. Heuristic curation, no LLM cost:

**Always durable (write immediately):**
- `edit` / `write` tool calls (code mutations)
- `git commit` results
- Tool errors / failures (prevent repeat mistakes)
- User-pinned results

**Durable if linked (write at slide time):**
- `read` / `grep` / `bash` that preceded a mutation on same file
  (investigation that led to action)

**Ephemeral (never written to JSONL):**
- `ls`, `find` with no follow-up action
- `read` of files never edited
- Exploration that led nowhere

**Explicit capture:**
- `/remember` command → user marks something as durable
- Decisions, gotchas, learnings

### Read policy — how JSONL is consumed

Pull-based, never bulk-loaded:

**1. Session start — minimal briefing (~20 lines)**
```
Scan events.jsonl for current git root:
  → last 5 decisions
  → unresolved errors
  → hot files (most mutated)
  → inject as orientation briefing
```

**2. During session — acm_recall searches both layers**
```
acm_recall(query: "auth")
  → search session LadybugDB (current session context)
  → search events.jsonl (past session history)
  → merge results, rank by relevance + recency
```

**3. Before file edit — precheck from JSONL**
```
User does edit auth.ts
  → grep events.jsonl for auth.ts
  → found: prior failed attempt, decision, fix
  → surface as warning/context before edit proceeds
```

**4. Never — bulk dump entire JSONL into context**

### events.jsonl format

```jsonl
{"ts":1720000000,"type":"fix","tool":"edit","files":["src/auth.ts"],"keywords":["jwt","refresh","token"],"summary":"Fixed token expiry check: < to <=","session":"abc123","gitRoot":"/Users/x/project"}
{"ts":1720000100,"type":"decision","tool":"edit","files":["config.ts"],"keywords":["database","pool"],"summary":"Switched to connection pooling, max 10","session":"abc123","gitRoot":"/Users/x/project"}
{"ts":1720000200,"type":"error","tool":"bash","files":["src/auth.ts"],"keywords":["test","fail","jwt"],"summary":"Auth test failing: mock not reset between tests","session":"def456","gitRoot":"/Users/x/project"}
```

Flat, greppable, one line per event. No nesting. Keywords enable fast search without index.

## Decision Gate: turn_end + LLM Reasoning Capture

Date: 2026-07-05

### Key Insight

Pi SDK exposes `turn_end` event with `event.message` (assistant's full text)
and `event.toolResults` (tool results from that turn). We can capture LLM
reasoning WITHOUT extra LLM calls — it's already in the assistant message.

### Full Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pi Agent Session                            │
│                                                                │
│  User prompt                                                   │
│    │                                                           │
│    ▼                                                           │
│  ┌──────────────────────────────────────────┐                  │
│  │  LLM Turn                                │                  │
│  │                                          │                  │
│  │  1. LLM reads context + reasons          │                  │
│  │  2. LLM calls tools (read/edit/bash)     │                  │
│  │  3. tool_result fires per tool ──────────┼──► Session Graph │
│  │     (ACM intercepts, caches large ones)  │   (LadybugDB)   │
│  │                                          │                  │
│  │  4. turn_end fires ──────────────────────┼──► Decision Gate │
│  │     event.message = assistant text       │       │          │
│  │     event.toolResults = tool outputs     │       │          │
│  └──────────────────────────────────────────┘       │          │
│                                                     ▼          │
│                                              ┌─────────────┐  │
│                                              │ Promote?    │  │
│                                              │             │  │
│                                              │ Mutation?───┼─YES─┐
│                                              │ Error?──────┼─YES─┤
│                                              │ Decision?───┼─YES─┤
│                                              │ Exploration?┼─NO  │
│                                              └─────────────┘    │
│                                                     │           │
│                                                     ▼           │
│                                              ┌─────────────┐   │
│                                              │ Project     │   │
│                                              │ Graph (LDB) │   │
│                                              │ .pi/memory  │   │
│                                              │ .lbug       │   │
│                                              └─────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Decision Gate Logic

Deterministic, no extra LLM call. Uses tool metadata + assistant message:

```
turn_end fires with:
  event.message.content  = "I see token expiry uses < instead of <=. Fixing..."
  event.toolResults      = [{ toolName: "edit", input: { path: "auth.ts" }, ... }]

Decision gate evaluates:
  1. Any mutation tool? (edit/write) ──────────► PROMOTE as "fix" or "decision"
  2. Any tool error?    (isError=true) ────────► PROMOTE as "error"
  3. Git commit?        (bash + git commit) ───► PROMOTE as "fix"
  4. Only reads/investigation? ────────────────► BUFFER (may promote later if
                                                  followed by mutation on same file)
  5. ls/find exploration? ─────────────────────► SKIP
```

### Reasoning Extraction

From assistant message text, extract first meaningful sentence as summary.
No LLM call — simple heuristic:

```
assistant text: "I see the token expiry check uses `<` instead of `<=`.
                 This means tokens expire one second too early. Fixing..."

extracted summary: "token expiry check uses < instead of <="
```

Stored as `summary` field on the ProjectGraphEvent. Enriches keyword search
with LLM's reasoning — the "why" behind the change.

### Buffered Investigation Pattern

```
turn 1: read auth.ts        → BUFFER (investigation)
turn 2: read middleware.ts   → BUFFER (investigation)
turn 3: edit auth.ts         → PROMOTE (mutation)
         └─ also promotes buffered reads of auth.ts (linked investigation)
         └─ middleware.ts read stays buffered (unrelated)
turn 4: no more edits        → middleware.ts buffer expires at slide time
```

### Event Shape for Project Graph

```typescript
{
  id: "turn-5-edit-auth.ts",
  toolName: "edit",
  keyTerms: "auth jwt token expiry",
  eventType: "fix",
  files: ["src/auth.ts"],
  sessionId: "session-abc",
  timestamp: 1720000000,
  summary: "token expiry check uses < instead of <=",  // from LLM reasoning
  linkedInvestigations: ["turn-3-read-auth.ts"],       // buffered reads promoted
}
```

## Priority

1. Project-scoped DB (biggest impact, solves core problem) ✅ done
2. Decision gate + turn_end wiring (this section)
3. Schema enrichment (GitRepo, Session, Decision nodes + new fields)
4. Cross-project gotchas JSONL (low effort, high value)
5. Pre-action file check (nice to have)
6. ChromaDB semantic layer (future, only if recall quality degrades)

---

## Appendix A: Project-level LadybugDB — Concurrency Design

Date: 2026-07-05

### Key Discovery

LadybugDB supports **multiple read-only connections** to the same DB file.
Only the read-write connection must be singular (per process).

From `database.h`:
```
readOnly: true  → Multiple read-only Database objects on SAME path ✅
readOnly: false → Only ONE read-write Database object per path ❌
```

This makes project-level LadybugDB viable without a separate store.

### Discarded Approaches

**SQLite WAL as project graph:** Concurrent-safe, but adds second DB technology.
SQL joins for graph traversal are clunky vs Cypher. Unnecessary if LadybugDB
read-only concurrency works.

**Pure JSONL:** Flat, no relationships. Organic relations (3 files edited together)
can't be stored as graph edges. Inferring relations from flat data = lossy, fake.

**JSONL + rebuild graph per session:** Wasteful. Discards session LDB each time.
Relations are organic, captured at edit-time — shouldn't be deduced from flat file.

### Chosen Design: Project LDB with flock

```
┌──────────────────────────────────────────────────────┐
│  Project LadybugDB  (.project/memory.lbug)           │
│  Single file, persistent across sessions             │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Pi Session 1│  │ Pi Session 2│  │ Pi Session 3│  │
│  │ read-only   │  │ read-only   │  │ read-only   │  │
│  │ open always  │  │ open always │  │ open always │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                │          │
│         └───── writes go through flock ───┘          │
│                          │                           │
│                    ┌─────▼─────┐                     │
│                    │  flock()  │                      │
│                    │ EXCLUSIVE │                      │
│                    └─────┬─────┘                      │
│                    close read-only                    │
│                    open read-write                    │
│                    batch insert                       │
│                    close read-write                   │
│                    reopen read-only                   │
│                    unlock                             │
└──────────────────────────────────────────────────────┘
```

### Write Path (rare, bursty)

```
1. flock(EXCLUSIVE, .project/memory.lock)
2. Close read-only handle
3. Open DB read-write
4. Batch insert (nodes + edges)
5. Close DB
6. Reopen DB read-only
7. Release flock
```

Writes happen on: edit/write tool calls, git commits, slide flush.
Lock held for milliseconds (batch insert = fast).

### Read Path (frequent, fast)

```
1. DB already open read-only (long-lived handle)
2. Query directly — no lock needed
3. Multiple sessions read concurrently ✅
```

Graph traversal, file history, relationship queries — all direct reads.

### Alternative: Unix Socket Manager (heavier)

```
First pi session → spawns manager process
Manager opens DB read-write, listens on .project/ldb.sock
All sessions: read-only direct + writes via socket to manager
Manager dies on last disconnect or idle timeout
```

More complex, but avoids open/close churn on write path.
Only needed if flock pattern causes performance issues (unlikely
given write frequency).

### Benefits

- **One DB technology** — LadybugDB for both session and project
- **Same schema** — ToolResult, FilePath, References, Follows
- **Organic relations preserved** — 3 files edited together = real edges, not inferred
- **Cross-session queries** — "what happened to auth.ts?" across all sessions
- **No JSONL needed** — graph is the source of truth
- **Cypher queries** — native graph traversal, not SQL joins

### Open Questions

- Where does project DB live? `.pi/memory.lbug` in git root? (gitignored)
- How to detect git root? `git rev-parse --show-toplevel`
- Session DB still needed for hot cache? Or project DB fast enough for both?
- Cross-project gotchas still need separate store (global, not per-project)
- What's the flock behavior on macOS vs Linux? (both support `flock(2)`)
