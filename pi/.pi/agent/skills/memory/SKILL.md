---
name: memory
description: >
  Ingest a Claude Code or pi-agent session into the llm-wiki knowledge base.
  Parses JSONL session files, extracts clean conversation transcript, drops it
  into raw/sessions/ for standard wiki ingest. Use when user says "/memory",
  "save session", "ingest session", or "remember this session".
---

# Memory — Session Ingest for LLM Wiki

Parse an LLM coding session into a clean markdown document and drop it into the wiki's `raw/sessions/` directory for standard ingest.

## When to Use

- User says `/memory`, "save this session", "ingest session", "remember this"
- User wants to capture decisions, insights, or knowledge from a session into their wiki

## Prerequisites

- The llm-wiki project must exist (check for `CLAUDE.md` with wiki schema)
- The wiki root is determined by: explicit user path > current working directory > `~/llm-wiki`

## Workflow

### Step 1: Identify the Session

Determine which session to ingest. Options (try in order):

1. **User provides a path** — use that JSONL file directly
2. **User says "this session" or "current"** — find the current session:
   - Pi sessions: `~/.pi/agent/sessions/<encoded-cwd>/` — pick latest `.jsonl`
   - Claude Code sessions: `~/.claude/projects/<encoded-cwd>/` — pick latest `.jsonl`
3. **User says "last session" or "previous"** — pick second-latest from above
4. **Ambiguous** — list recent sessions with dates/sizes, ask user to pick

**Path encoding**: Both pi and Claude Code encode the cwd path:
- Pi: `--` prefix, `/` → `-`, e.g. `--Users-skynet-myproject--`
- Claude Code: `-` prefix, `/` → `-`, e.g. `-Users-skynet-myproject`

### Step 2: Parse the Session

Run the parser script bundled with this skill:

```bash
python3 <skill-dir>/parse-session.py <session-file> [--output <output-path>] [--format <pi|claude>]
```

The parser:
- Auto-detects format (pi vs Claude Code) from first line
- Extracts user messages and assistant text responses
- Strips: tool calls/results, system prompts, ACM status, hooks, metadata, thinking blocks
- Preserves: code blocks shared in conversation, key outputs mentioned in assistant responses
- Adds YAML frontmatter: title, date, session_id, project, duration_estimate
- Groups conversation into numbered exchanges (Human/Assistant pairs)

If parser fails, fall back to manual parsing:
- Read the JSONL file
- For each line, parse JSON
- Keep entries where type is "user" or "assistant"/"message" with role "assistant"
- Extract text content, skip tool_use blocks
- Format as clean markdown

### Step 3: Review with User

Before saving, show the user:
- Session date and estimated duration
- Number of exchanges extracted
- Top topics detected (scan for headers, key terms, project names)
- Approximate word count

Ask: **"What should I emphasize? Any topics to skip?"**

### Step 4: Save to raw/

Save the cleaned transcript to:
```
<wiki-root>/raw/sessions/<date>-<session-name>.md
```

Where:
- `<date>` is ISO date from session timestamp (e.g., `2026-05-23`)
- `<session-name>` is kebab-case derived from: user-provided name > session project > auto-generated from topics

### Step 5: Trigger Ingest

Tell the user the file is ready and suggest running the standard wiki ingest:
> "Session saved to `raw/sessions/<filename>`. Ready for wiki ingest — want me to process it now?"

If user confirms, follow the standard ingest workflow from `CLAUDE.md`:
1. Read the source completely
2. Discuss key takeaways with user
3. Create source summary in `wiki/sources/`
4. Create/update entity and concept pages
5. Flag contradictions
6. Update index.md, log.md, overview.md

For the source summary, use `source_type: session` and adapt sections:
- **Key Takeaways** — decisions made, insights discovered, problems solved
- **Detailed Summary** — topic-by-topic breakdown (not chronological)
- **Notable Quotes** — keep if there are genuinely quotable insights; otherwise rename to **Key Decisions**
- **Questions Raised** — open questions, unresolved issues, future work identified

## Session Format Reference

### Pi Agent JSONL
```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"..."}
{"type":"message","id":"...","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
{"type":"message","id":"...","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
{"type":"tool_call","id":"...","tool":"bash","input":{"command":"..."}}
{"type":"tool_result","id":"...","content":"..."}
```

### Claude Code JSONL
```jsonl
{"type":"user","message":{"role":"user","content":"..."},"timestamp":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]},"timestamp":"..."}
{"type":"tool_use","..."}
{"type":"tool_result","..."}
```

## Noise Filtering Rules

**Always strip**:
- Tool calls and tool results (bash commands, file reads, edits)
- System prompts and permission mode entries
- ACM status tags (`<context-status>`, `<pruned-manifest>`)
- Hook events (SessionStart, etc.)
- Thinking blocks
- File history snapshots
- Model change / thinking level entries
- Usage/token metadata

**Always keep**:
- User messages (full text)
- Assistant text responses (the actual conversation)
- Code blocks that appear in assistant text (not tool outputs)

**Optionally keep** (if user requests verbose mode):
- Key tool outputs that represent important results
- Error messages that led to decisions
