# ACM Testing Guidelines

Two layers: **pure unit tests** (fast, deterministic) and **live headless runs**
(real SDK pipeline, catches integration truths that unit tests can't).

Principle: nothing is proven until proven with data. Unit tests prove logic;
live runs prove the logic holds against the real SDK message pipeline.

---

## 1. Unit tests

- Location: `__tests__/` (repo convention). NOT colocated in `acm-lib/`.
- Import source via relative path with `.ts`:
  `import { fn } from "../acm-lib/module.ts";`
- Runner: vitest binary lives in `acm-lib/node_modules`. Run from agent root
  so `../acm-lib/*.ts` imports resolve:

```bash
cd ~/.pi/agent
node acm-lib/node_modules/vitest/vitest.mjs run __tests__/<file>.test.ts
# all:
node acm-lib/node_modules/vitest/vitest.mjs run __tests__/
```

- Extract pure functions from the context handler so they're unit-testable
  (e.g. `alignEntryIds`, `buildEntryMap`, `resolveId`, `injectAcmContext`,
  `prependPinned`). The handler itself is SDK-coupled — keep it thin, push
  logic into pure modules.

### TDD loop
1. Write the test first (behavior = spec). Run → it MUST fail (red).
2. Minimal implementation → run → green.
3. Commit atomically.

---

## 2. Live headless verification (tmux + `pi -p`)

Use when a claim depends on the real SDK pipeline (message rebuild, slide,
clear, tool-call ordering, extension wiring). Do NOT assume — measure.

### Enable debug logging
The extension logs to `/tmp/ladybug-acm.log` when `ACM_DEBUG` is set:

```ts
const ACM_LOG = "/tmp/ladybug-acm.log";
const ACM_DEBUG = process.env.ACM_DEBUG === "true" || process.env.ACM_DEBUG === "1";
function acmLog(s: string) { if (ACM_DEBUG) appendFileSync(ACM_LOG, `[${new Date().toISOString()}] ${s}\n`); }
```

Gate all diagnostics behind `ACM_DEBUG`. Keep cheap self-checks permanently
(e.g. the ALIGN-CHECK cross-check); remove verbose dumps after use.

### Run pi headless
```bash
# single turn, no persistence
ACM_DEBUG=1 pi -e ~/.pi/agent/extensions/acm.ts --no-session --mode json -p "prompt"

# multi-turn accumulation: reuse --session-id (creates if missing).
# WARNING: do NOT add -c / --continue — it fought accumulation in testing.
SID=test-$(date +%s)
for m in "msg one" "msg two" "msg three"; do
  ACM_DEBUG=1 pi -e ~/.pi/agent/extensions/acm.ts --session-id "$SID" --mode json -p "$m" >/dev/null 2>&1
done
```

Flags: `-e <ext>` load extension · `-p` non-interactive · `--mode json`
machine-readable output · `--session-id <id>` reuse session · `--no-session`
ephemeral.

### Force specific pipeline states
- **Tool calls / toolResults**: `-p "run bash: echo alpha"` (gives an
  independent-truth key `toolCallId` for cross-checks).
- **Parallel tool calls** (timestamp-collision stress):
  `-p "Read these 3 files in parallel in one turn: a b c"`.
- **Slide**: `-p "Call acm_slide with keepMessages=1 now."`
- **Pin flow**: `-p "Call acm_map, find the row whose preview mentions X,
  then acm_pin its 8-char id prefix."`

### Inspect results
```bash
rm -f /tmp/ladybug-acm.log        # clear before a run
grep -E "ALIGN-CHECK|ALIGN-MISMATCH" /tmp/ladybug-acm.log   # guard
```

Parse JSON-mode output (assistant text / tool results) with python:
```bash
python3 -c "
import json,sys
for l in open('/tmp/out.json'):
    try:
        e=json.loads(l); m=e.get('message',{})
        if m.get('role')=='toolResult':
            c=m.get('content'); t=c if isinstance(c,str) else ' '.join(b.get('text','') for b in c if isinstance(b,dict))
            print(t[:200])
    except: pass"
```

Session JSONL (source of truth for entry IDs / structure):
```bash
ls -t ~/.pi/agent/sessions/--tmp--/*<sid>*.jsonl | head -1
```

---

## 3. Cross-check pattern (independent truth)

When verifying a mapping/alignment, validate against a DIFFERENT source that
you did not use to build it. Example: entry-ID position alignment is
cross-checked against `toolCallId → entryId` (`tcEntryId`), which is
independent of position. `bad=0` across scenarios = proven.

Keep the cross-check as a permanent `ACM_DEBUG` guard so future refactors
that break alignment surface immediately.

---

## 4. Checklist before committing a pipeline change

- [ ] Pure logic extracted + unit-tested (red → green).
- [ ] `node acm-lib/node_modules/vitest/vitest.mjs run __tests__/` all green.
- [ ] Live headless run: no-slide AND slide-active, `bad=0`.
- [ ] Verbose diagnostics removed; cheap guards kept behind `ACM_DEBUG`.
- [ ] Clean up `/tmp/ladybug-acm.log` and temp session files.
- [ ] Do NOT stage unrelated changes (keyd/mise/settings.json) — stage
      explicit files only.
