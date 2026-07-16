# ACM Pin — Design

## Problem

LLM can't pin messages because it doesn't know entry IDs.
Entry IDs are internal (hex UUIDs in JSONL), never exposed to LLM context.

## Critical finding (verified via live pi run, ACM_DEBUG)

Object reference identity does NOT survive from branch to event.messages.
The SDK rebuilds message objects, stripping all keys except:

    [ role, content, timestamp ]

```
branch entry.message  ─── objRefA  (id=6754f1fe, ts=1784191742361)
event.messages[0]     ─── objRefB  (ts=1784191742361)   ← different object!

msgEntryId.get(objRefB) → UNDEFINED   ← ref keying is BROKEN
```

But `timestamp` survives the rebuild and is UNIQUE per message
(verified: uniqueTs=3 dupes=0 across user/assistant/toolResult).

## Solution: key by timestamp, not object ref

```
Build from branch:  tsToEntryId : Map<timestamp, entryId>

Lookup anywhere:    tsToEntryId.get(msg.timestamp) → entryId
```

Why this is simpler:
- Spread mutation `{ ...m }` copies timestamp → resolves for FREE (no manual transfer)
- In-place mutation → timestamp unchanged → resolves
- Only synthetic pinned messages need an explicit timestamp assigned

```
Context pipeline (every turn):
  getBranch() → build tsToEntryId (ts → id) → slide → clear → compact → prepend pinned
                        │                                              │
                        │                              synthetic pinned: assign ts + register
                        ▼                                              ▼
                  lastTsToEntryId                            lastContextMessages
                        │                                              │
                        └──────────────────┬───────────────────────────┘
                                           ▼
                                 acm_map: for each visible msg,
                                          tsToEntryId.get(msg.timestamp)
                                           │
                                           ▼
                                 acm_pin("abc1") → resolveId → prefix match
```

## Actionable items

### 1. buildEntryMap: key by timestamp
   `buildEntryMap(messages, tsToEntryId: Map<number,string>)`
   lookup via `tsToEntryId.get(msg.timestamp)`

### 2. context-mutations: timestamp-based
   - injectAcmContext: spread already preserves timestamp → NO map change needed
   - prependPinned: assign synthetic.timestamp, register in tsToEntryId
     (store original message timestamp in PinnedContentEntry when pinning)

### 3. acm.ts context handler
   - build `tsToEntryId` from branch (message.timestamp → entry.id)
   - set `lastTsToEntryId` + `lastContextMessages` after mutations

### 4. acm_pin: resolve against visible timestamps
   - use lastTsToEntryId values (visible entry IDs), not raw getBranch()

## Tests (spec)
- resolveId prefix matching: ✅ done
- buildEntryMap by timestamp: TODO update
- context-mutations timestamp preservation: TODO update
- INVARIANT: every visible msg resolves to entry ID via timestamp
