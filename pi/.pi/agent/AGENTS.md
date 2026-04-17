## Core Principles
- Don't assume requirements — infer implementation details from code, ask user for business logic.
- Prioritise human input on logic dilemmas (e.g., ambiguous requirements, multiple valid approaches, destructive operations).

## MCP Tools
- `cc` = Context7 MCP — use for searching library/framework documentation.
- `exa` = Exa MCP — use for searching the internet for external information.

### cc (Context7) — Library Docs
Two-step process: resolve library ID first, then query docs.
```
# Step 1: Resolve library ID
mcp({ tool: "cc_resolve-library-id", args: '{"libraryName": "Next.js", "query": "how to set up middleware"}' })
# Returns library ID like /vercel/next.js

# Step 2: Query docs using resolved ID
mcp({ tool: "cc_query-docs", args: '{"libraryId": "/vercel/next.js", "query": "how to set up middleware"}' })
```
- Max 3 calls per tool per question. If no good match after 3 attempts, proceed with closest result and note uncertainty to user.
- Use official library names with proper punctuation (e.g., "Next.js" not "nextjs").
- Query should be specific and descriptive, not just keywords.
- If `resolve-library-id` returns no results, try alternate library names or fall back to `exa` web search.

### exa — Web Search & Fetch
```
# Search the web (describe ideal page, not keywords)
mcp({ tool: "exa_web_search_exa", args: '{"query": "blog post comparing React and Vue performance", "numResults": 5}' })

# Fetch full content from URL(s) when search highlights aren't enough
mcp({ tool: "exa_web_fetch_exa", args: '{"urls": ["https://example.com/article"], "maxCharacters": 3000}' })
```
- Query tip: describe the ideal page, not keywords.
- Batch multiple URLs in one `web_fetch_exa` call.
- If search returns irrelevant results, rephrase query or narrow with date/domain filters.

## Task Management
- `tk` is the task management utility. It's installed in the system.
- Always create tasks and atomic subtasks in tk.
  - "atomic" = one logical change that can be independently verified and committed (same granularity as a git commit).
- For each parent task, record the plan, reasoning, and thought process in its note.
- Each subtask must have its own detailed note explaining scope and context.
- Proactively update task and subtask notes when plans or circumstances change.
- Before creating tasks, check `tk list` to avoid duplicates.
- On failure: update subtask note with error details, ask user before retrying or changing approach.
- Usual commands:
   tk list                                    # list all tasks
   tk create -name "fix bug" [-parent-id 5] [-note ".."] [-priority high] [-type bug]
   tk edit -id DE-3 [-name ".."] [-note ".."] [-priority low|medium|high|critical]
   tk start -id DE-3                          # mark active
   tk done -id DE-3                           # mark complete
- Use `tk help -json` for additional info.

## Workflow
- Do not jump into implementation. First analyze the task, create a detailed plan with subtasks, present it as a numbered subtask list to the user, and only proceed after explicit approval (e.g., "go", "approved").
- A task is done when: implementation complete, tests pass, and user confirms.

## Testing
- Write tests alongside implementation. Ensure key logic paths are covered.
- Tests are not optional — every subtask with logic changes should have corresponding test coverage.

## Git
- For each task done, make atomic commits as needed.
- Commit messages explain "why", not "what" changed. The diff shows what.
- Each commit should represent exactly one logical change.
- Never bundle unrelated changes in a single commit.
- Never use interactive rebase (`git rebase -i`). Use `git rebase <ref> --exec '...'` for batch operations.
