# Extension Testing Guidelines

General methodology for testing pi extensions. For extension-specific setup
(debug flags, log paths, state-forcing prompts), see that extension's own
`TESTING.md` (e.g. `acm-lib/TESTING.md`).

Two layers: **pure unit tests** (fast, deterministic) and **live headless runs**
(real SDK pipeline, catches integration truths unit tests can't).

Principle: nothing is proven until proven with data. Unit tests prove logic;
live runs prove the logic holds against the real SDK message pipeline.

---

## 1. Unit tests

- Location: `__tests__/` (repo convention). NOT colocated with source.
- Import source via relative path with `.ts`:
  `import { fn } from "../<lib>/module.ts";`
- Runner: vitest binary lives in a lib's `node_modules`. Run from agent root
  so `../<lib>/*.ts` imports resolve:

```bash
cd ~/.pi/agent
node <lib>/node_modules/vitest/vitest.mjs run __tests__/<file>.test.ts
# all:
node <lib>/node_modules/vitest/vitest.mjs run __tests__/
```

- Extension handlers are SDK-coupled and hard to unit-test directly. Keep the
  handler thin; push logic into pure, dependency-free functions and test those.

### TDD loop
1. Write the test first (behavior = spec). Run → it MUST fail (red).
2. Minimal implementation → run → green.
3. Commit atomically.

---

## 2. Live headless verification (tmux + `pi -p`)

Use when a claim depends on the real SDK pipeline (message rebuild, slide,
clear, tool-call ordering, extension wiring). Do NOT assume — measure.

### Debug logging
Gate all diagnostics behind an env flag; write to a temp log file. Keep cheap
self-checks permanently; remove verbose dumps after use. (Exact flag/path is
per-extension — see its TESTING.md.)

### Run pi headless
```bash
# single turn, no persistence
<DEBUG_ENV>=1 pi -e ~/.pi/agent/extensions/<ext>.ts --no-session --mode json -p "prompt"

# multi-turn accumulation: reuse --session-id (creates if missing).
# WARNING: do NOT add -c / --continue — it breaks accumulation in headless mode.
SID=test-$(date +%s)
for m in "msg one" "msg two" "msg three"; do
  <DEBUG_ENV>=1 pi -e ~/.pi/agent/extensions/<ext>.ts --session-id "$SID" --mode json -p "$m" >/dev/null 2>&1
done
```

Flags: `-e <ext>` load extension · `-p` non-interactive · `--mode json`
machine-readable · `--session-id <id>` reuse session · `--no-session` ephemeral.

### Inspect results
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
ls -t ~/.pi/agent/sessions/<project-slug>/*<sid>*.jsonl | head -1
```

---

## 3. Cross-check pattern (independent truth)

When verifying a mapping/alignment, validate against a DIFFERENT source than the
one used to build it. If they agree across scenarios (`bad=0`), it's proven.
Keep the cross-check as a permanent debug-gated guard so future refactors that
break the invariant surface immediately.

---

## 4. Checklist before committing a pipeline change

- [ ] Pure logic extracted + unit-tested (red → green).
- [ ] `node <lib>/node_modules/vitest/vitest.mjs run __tests__/` all green.
- [ ] Live headless run covers the relevant pipeline states, guard `bad=0`.
- [ ] Verbose diagnostics removed; cheap guards kept behind the debug flag.
- [ ] Clean up temp logs and temp session files.
- [ ] Do NOT stage unrelated changes (keyd/mise/settings.json) — stage explicit
      files only.
