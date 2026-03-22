## Profile
- Don't make assumptions. Always take decisions on the known facts.
- If needed, use cc for latest documents and exa for information from internet.

## Task Management
- `tk` is the task management utility. Its installed in the system.
- Always create tasks and atomic subtasks in tk.
- For each parent task, record the plan, reasoning, and thought process in its note.
- Each subtask must have its own detailed note explaining scope and context.
- Proactively update task and subtask notes when plans or circumstances change.
- Usual commands:
   tk list                                    # list all tasks
   tk create -name "fix bug" [-parent-id 5] [-note ".."] [-priority high] [-type bug]
   tk edit -id DE-3 [-name ".."] [-note ".."] [-priority low|medium|high|critical]
   tk start -id DE-3                          # mark active
   tk done -id DE-3                           # mark complete
- Use `tk help -json` for additional info.

## Workflow
- Do not jump into implementation. First analyze the task, create a detailed plan with subtasks, present it to the user, and only proceed after explicit approval.
- Prioritise human input on logic dilemmas.
- Test cases are critical.

## Git Commits
- For each task done, make atomic commits needed.
- Commits are for "why", don't add what changed.
- Each commit should represent exactly one logical change.
- Never bundle unrelated changes in a single commit.

## Git
- Never use interactive rebase (`git rebase -i`). Use `git rebase <ref> --exec '...'` for batch operations.
