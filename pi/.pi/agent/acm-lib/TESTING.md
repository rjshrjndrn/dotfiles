# ACM Testing Specifics

ACM-specific setup for the general method in `~/.pi/agent/TESTING.md`.

---

## Debug flag & log

```ts
// extensions/acm.ts
const ACM_LOG = "/tmp/ladybug-acm.log";
const ACM_DEBUG = process.env.ACM_DEBUG === "true" || process.env.ACM_DEBUG === "1";
function acmLog(s: string) {
  if (ACM_DEBUG) appendFileSync(ACM_LOG, `[${new Date().toISOString()}] ${s}\n`);
}
```

Enable with `ACM_DEBUG=1`. Clear the log before a run: `rm -f /tmp/ladybug-acm.log`.

---

## Ephemeral tier (acm_map)

acm_map is single-use: read once to pick an ID, then bloat (~13k). It is
cleared at the NEXT turn boundary unconditionally (no size/recency gate) but
survives its own turn so acm_pin can still read it.

Flow: `execute()` -> `ephemeralPending.add(toolCallId)` + `persist()` ->
next turn boundary -> `promoteEphemeral(pending, clearSet)` -> line 590 stubs.

GOTCHA: each `pi -p` is a SEPARATE process; `ephemeralPending` is in-memory,
so it MUST be persisted (via `acm-clear-state` -> `ephemeralPendingIds`) or
cross-process/reload loses the registration. acm_map persists on register
because the context handler already ran before its execute.

Verify live (separate processes via `--session-id`):
```bash
# turn 1 seed, turn 2 acm_map, turn 3 anything
grep -c "ephemeral promoted" /tmp/ladybug-acm.log   # 0 after map turn, 1 after N+1
grep -o "ephemeralPendingIds[^]]*]" <session>.jsonl  # [id] after map, [] after N+1
grep -o "clearedToolCallIds[^]]*]" <session>.jsonl   # contains map id after N+1
```

---

## Unit tests

vitest binary is under `acm-lib/node_modules`:

```bash
cd ~/.pi/agent
node acm-lib/node_modules/vitest/vitest.mjs run __tests__/
```

Pure modules under test: `resolveId` (id-resolver), `buildEntryMap` (entry-map),
`alignEntryIds` (context-mapping), `injectAcmContext` / `prependPinned`
(context-mutations).

---

## Forcing pipeline states

```bash
# tool calls / toolResults (gives toolCallId as independent-truth key)
-p "run bash: echo alpha"

# parallel tool calls (timestamp-collision stress)
-p "Read these 3 files in parallel in one turn: /etc/hostname /etc/os-release /proc/version"

# slide
-p "Call acm_slide with keepMessages=1 now."

# full pin flow
-p "Call acm_map, find the row whose preview mentions X, then acm_pin its 8-char id prefix."
```

Session JSONL path for `--tmp--` runs:
```bash
ls -t ~/.pi/agent/sessions/--tmp--/*<sid>*.jsonl | head -1
```

---

## Permanent guard: ALIGN-CHECK

The context handler cross-checks position-aligned `entryIds[]` against
`tcEntryId` (toolCallId → entryId, an independent source). Look for:

```bash
grep -E "ALIGN-CHECK|ALIGN-MISMATCH" /tmp/ladybug-acm.log
```

Expect `bad=0` in both no-slide and slide-active runs. Any `ALIGN-MISMATCH`
means position alignment drifted — a real regression.

### Why alignment (not object-ref or timestamp) — verified live
- Object refs do NOT survive the SDK message rebuild → ref-keyed maps come back
  empty (`resolved 0/1`).
- Timestamps COLLIDE for parallel tool results (3 toolResults share one ms) →
  not a unique key.
- Reliable method: position-align visible messages to branch message-entries;
  `null` for the slide summary; pinned prepends carry their store entry IDs.
