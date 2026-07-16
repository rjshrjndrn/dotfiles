# ACM Pin — Design

## Problem

LLM can't pin messages because it doesn't know entry IDs.
Entry IDs are internal (hex UUIDs in JSONL), never exposed to LLM context.

## Solution

```
Context pipeline (every turn):
  getBranch() → msgEntryId map → slide → clear → compact → prepend pinned
       │                                                        │
       │  on mutation: copy entry ID to new object ref          │
       │                                                        ▼
       │                                              final `messages`
       │                                                        │
       ▼                                                        ▼
  lastMsgEntryId (ref → entryId)              lastContextMessages
                    │                                    │
                    └──────────┬─────────────────────────┘
                               ▼
                    acm_map (shows what LLM sees)
                               │
                        ID        ROLE       PREVIEW
                        ghi78901  user       pin doesn't work
                        mno11111  assistant  Found the bug...
                               │
                               ▼
                    acm_pin("ghi7") → resolveId → prefix match → pinned
```

## Key invariant

**Entry ID is immutable identity from JSONL. When message object is replaced
during mutations, entry ID transfers to the new object ref.**

## Actionable items

### 1. Preserve entry ID across mutations in context handler

Locations where new message objects are created:
- **ACM context injection** (~line 636): `messages[i] = { ...m, content: [...] }`
- **Synthetic pinned messages** (~line 660): `messages.unshift(...)` 

Fix: after creating new object, copy mapping:
```typescript
const oldId = msgEntryId.get(m);
if (oldId) msgEntryId.set(messages[i], oldId);
```

### 2. Set lastContextMessages + lastMsgEntryId AFTER all mutations

Move assignment to right before `return { messages }`.
Currently set early (before mutations) — captures stale state.

**Status**: already moved in prior commit. Verify placement.

### 3. acm_pin: drop getBranch(), resolve against lastMsgEntryId

Current: `acm_pin` calls `getBranch()` directly — resolves against full
branch including slid-away entries.

Fix: resolve against `lastMsgEntryId` values (set of entry IDs visible
in context). LLM can only pin what it can see.

### 4. Tests

- `id-resolver.test.ts`: ✅ done (8/8)
- `entry-map.test.ts`: ✅ done (8/8)
- Add test: entry ID preserved after object spread mutation
- Add test: synthetic pinned message excluded from acm_map (no entry ID)
