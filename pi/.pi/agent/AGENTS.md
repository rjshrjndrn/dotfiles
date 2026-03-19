## Task Management
- `tk` is the task management utility. Its installed in the system.
- Use `tk help -json` to get the tool usage.
- Always create tasks and atomic subtasks in tk.
- For each parent task, record the plan, reasoning, and thought process in its note.
- Each subtask must have its own detailed note explaining scope and context.
- Proactively update task and subtask notes when plans or circumstances change.

## Workflow
- Do not jump into implementation. First analyze the task, create a detailed plan with subtasks, present it to the user, and only proceed after explicit approval.
- Prioritise human input on logic dilemmas.
- Test cases are critical.

## Commits
- For each task done, make atomic commits needed.
- Each commit should represent exactly one logical change.
- Never bundle unrelated changes in a single commit.
