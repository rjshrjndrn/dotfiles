## Core Principles
- Infer implementation from code. Ask user for business logic, ambiguity, destructive ops, or on failure before retry/pivot.

## MCP Tools
- `cc` (Context7) — library/framework docs. Two-step: `cc_resolve-library-id` → `cc_query-docs`. Official names ("Next.js" not "nextjs"). Max 3 calls per question. Fallback to `exa`.
- `exa` — web search/fetch. Describe ideal page, not keywords. Batch URLs. Narrow with date/domain if noisy.
- Discover schemas: `mcp({ describe: "tool_name" })`.

## Workflow
- Analyze → plan → present numbered subtasks → wait for explicit approval ("go", "approved") → implement.
- Atomic subtask = one logical change, independently verifiable = one git commit.
- Done = implementation + tests pass + user confirms.

## Tasks (`tk`)
- Discover commands: `tk help -json`. Check `tk list` before creating to avoid dupes.
- Parent note: plan + reasoning. Subtask note: scope + context. Update proactively.

## Testing
- Write tests alongside logic. Every subtask with logic changes needs coverage.

## Git
- One commit = one logical change. Never bundle unrelated.
- Messages explain "why", diff shows "what".
- Never `rebase -i`. Use `git rebase <ref> --exec '...'` for batch ops.
- Never git push
