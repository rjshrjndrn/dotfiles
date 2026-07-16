# ACM Pin / acm_map — Design

## Principle (decided)

**acm_map is a MIRROR of what the LLM actually sees, each line mapped to its
JSONL entry ID.**

It exists so the LLM can correlate the messages in its own context with the
immutable entry IDs needed for `acm_pin`.

Consequences:
- Preview = the **processed** content the LLM sees — cleared tool results show
  as their **stub**, compacted messages show compacted text. NOT raw branch
  content.
- **Pinned** messages that survived a slide are visible to the LLM (prepended
  synthetics) → they MUST appear in acm_map too, with their entry ID.
- Slid-away (non-pinned) messages are NOT visible → excluded from acm_map.

## Why object-ref / timestamp keying fails (verified live, ACM_DEBUG)

```
No-slide: event.messages = SDK-rebuilt objects (new refs).
          msgEntryId keyed on branch refs → get() = UNDEFINED (resolved 0/1).

Timestamp: parallel tool results share one millisecond.
          3 toolResults, same ts, 3 different entryIds → collision.
          (ts=1784192065311 ×3, distinct toolCallIds/entryIds)
```

Neither is a valid join key. The reliable source of entry IDs is the branch
itself (entry.id is immutable and co-located with content), combined with the
pipeline knowing each entry's id **at construction time**.

## Approach: build the mapping DURING the pipeline

The context handler transforms branch → final `messages` sent to the LLM.
Maintain a parallel `entryIds: (string|null)[]` alongside `messages`, so at the
end we have `[{ entryId, message }]` for every message the LLM sees.

```
Pipeline stage        | effect on messages          | effect on entryIds[]
----------------------+-----------------------------+----------------------------
init (no slide)       | event.messages (SDK refs)   | position-align to branch
                      |                             |   message-entries in order
slide active          | [summary] + branch[cutoff..]| [null] + branch[cutoff..].id
clear (tool result)   | msg.content = stub (inplace)| unchanged (entryId known via
                      |                             |   tcEntryId if needed)
compact               | msg.content = summary (ip)  | unchanged
pin prepend           | unshift K synthetics        | unshift K store entryIds
```

Key facts that make this work (verified live):
- No-slide: branch message-entries count == event.messages count, same order
  → position alignment is valid.
- Slide: rebuilt messages are literal branch `entry.message` refs (+ summary),
  so their entry IDs are known directly from the branch loop.
- Pin: each synthetic comes from `pinnedContentStore`, which stores its
  `entryId` → known at construction.
- Slide summary: synthesis of many discarded entries → `entryId = null`,
  shown in acm_map as a non-pinnable `[slide summary]` line.

## acm_map output

```
ID        ROLE       PREVIEW
────────────────────────────────────────────────────────────
—         summary    [slide summary] fact one sky blue; fact ...
2c900246  user        Call the acm_slide tool now with keepMes
60393606  assistant   [thinking,toolCall]
c3bca4ee  toolResult  [cleared: bash | 42 lines]     ← stub, matches LLM view
```

## acm_pin

- LLM reads acm_map tool result → picks an ID (or prefix).
- `acm_pin(entryId)` → `resolveId()` prefix match against the visible entry IDs.
- resolveId already implemented + tested (prefix, exact, ambiguous).

## Assumptions / guards

- Position alignment assumes no upstream extension reorders/injects messages
  between branch and this handler. If `event.messages` count != branch
  message-entry count in the no-slide path, log a warning and fall back to
  raw-branch mapping (best effort) rather than mis-mapping.

## State to stash for the tool

```
lastVisible: { entryId: string | null; role: string; preview: string }[]
```
Set at the END of the context handler (after all mutations). `acm_map` reads it.

## Implementation checklist

1. Remove diagnostic logging from acm.ts.
2. Revert moot work:
   - buildEntryMap(messages, msgEntryId) signature
   - context-mutations.ts entry-ID transfer (not needed)
   - lastContextMessages / lastMsgEntryId / tsToEntryId
3. In context handler, maintain `entryIds[]` parallel to `messages` through
   slide / clear / compact / pin; build `lastVisible` at the end.
4. buildEntryMap(lastVisible) → pure formatter (id short, role, preview).
5. acm_map tool → format lastVisible.
6. acm_pin → resolveId against lastVisible entry IDs (exclude nulls).

## Tests (spec)

- resolveId: prefix / exact / ambiguous / not-found — DONE.
- buildEntryMap(lastVisible): formats rows, truncates preview, shorts id,
  skips null-id summary from pinnable set (still displayed).
- Pipeline mapping (pure-extracted):
  - no-slide position alignment maps every message to its entry id
  - slide: summary→null, rest→cutoff-onward ids
  - clear: stub preview, entry id preserved
  - pin: synthetic prepend carries store entry id
  - INVARIANT: every non-summary visible message resolves to an entry id
- Live (tmux, ACM_DEBUG): slide=none shows all; slide=active shows
  cutoff-onward — DONE for raw-branch sim; re-verify with processed mapping.
