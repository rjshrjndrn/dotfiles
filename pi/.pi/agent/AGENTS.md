## Core Principles
- Don't assume requirements — infer implementation details from code, ask user for business logic.
- Prioritise human input on logic dilemmas (e.g., ambiguous requirements, multiple valid approaches, destructive operations).

## MCP Tools
- `cc` (Context7) — library/framework docs. Two-step: `cc_resolve-library-id` → `cc_query-docs`. Use official names ("Next.js" not "nextjs"). Max 3 calls per question. Fallback to `exa` if no match.
- `exa` — web search/fetch. Describe ideal page, not keywords. Batch URLs in one `exa_web_fetch_exa` call. Narrow with date/domain filters if noisy.
- Discover schemas on demand: `mcp({ describe: "tool_name" })`.

## Task Management
- `tk` = task utility (installed). Discover commands: `tk help -json`.
- Create tasks + atomic subtasks. Atomic = one logical change, git-commit granularity.
- Parent task note: plan, reasoning, thought process. Subtask note: scope + context.
- Update notes proactively when plans change.
- `tk list` before creating to avoid duplicates.
- On failure: log error in subtask note, ask user before retry/pivot.

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
