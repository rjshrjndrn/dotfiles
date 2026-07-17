---
description: Delete pi session transcripts (.jsonl) older than N days
argument-hint: "[days=7]"
---

Prune old pi session transcripts. Scope STRICTLY to `~/.pi/agent/sessions/`.

Days threshold: `$1` — if empty, default to **7**.

Rules:
- Delete only `*.jsonl` files whose mtime is older than the cutoff (now minus N days).
- Keep all folders and every `.acm/` cache dir untouched (orphan cache is accepted tradeoff).
- Note: filesystem uses `relatime`, so atime is unreliable — use **mtime** as the "last used" proxy.

Steps:
1. Compute cutoff = N days ago. Run a DRY-RUN first with:
   ```bash
   cd ~/.pi/agent/sessions; N=${1:-7}; cutoff=$(date -d "$N days ago" +%s)
   echo "cutoff=$(date -d @$cutoff '+%Y-%m-%d %H:%M')"
   echo "DELETE: $(find . -maxdepth 2 -name '*.jsonl' -not -newermt "@$cutoff" | wc -l)"
   echo "KEEP:   $(find . -maxdepth 2 -name '*.jsonl' -newermt "@$cutoff" | wc -l)"
   echo "FREES:  $(find . -maxdepth 2 -name '*.jsonl' -not -newermt "@$cutoff" -printf '%s\n' | awk '{s+=$1} END{print s/1024/1024" MB"}')"
   echo "NEWEST-DELETED:"; find . -maxdepth 2 -name '*.jsonl' -not -newermt "@$cutoff" -printf '%TY-%Tm-%Td %p\n' | sort | tail -2
   ```
2. Show the dry-run counts + size + newest-deleted to the user. Warn this is an irreversible delete.
3. Wait for explicit confirmation ("go"/"yes"). Do NOT delete before confirmation.
4. On confirm, delete:
   ```bash
   cd ~/.pi/agent/sessions; N=${1:-7}; cutoff=$(date -d "$N days ago" +%s)
   before=$(find . -maxdepth 2 -name '*.jsonl' | wc -l)
   find . -maxdepth 2 -name '*.jsonl' -not -newermt "@$cutoff" -delete
   after=$(find . -maxdepth 2 -name '*.jsonl' | wc -l)
   echo "deleted $((before-after)) jsonl (before=$before after=$after)"
   ```
