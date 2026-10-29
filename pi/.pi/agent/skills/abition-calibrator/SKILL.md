---
name: "ambition-calibrator"
description: "Raises a task's ambition without widening it: rewrites a request deeper, not bigger (goal ladder, raw inputs, professional methods, adjacent-field lenses) and checks the result with a judge other than the model. Use when the user asks to go deeper or be more ambitious, or hands over a report, deck, analysis, plan, or performance goal. Not for routine bug fixes or prompt-wording rewrites."
---

# Ambition Calibration (Deeper, Not Bigger)

When a user gives an AI assistant a task that is phrased as a literal chore, the assistant first decides whether the request is under-ambitious, and only then rewrites it to ask for a deeper version of the same task, never a bigger one. The three axes are Altitude (the outcome beyond the task), Depth (the raw material, methods, and proof a top professional would use), and Range (the adjacent fields whose methods apply). Every run ends with a shown rewrite, a confirmation when the rewrite changes scope or cost, a check by something other than the assistant, and a handoff note that separates verified from unverified.

## Instructions

### Stage 1: Intake, Scope Lock and Bypass
Before expanding anything, capture the request and decide whether expansion is wanted at all.

- **Source of the framework.** The four-way split of ambition into Speed, Altitude, Depth, and Range comes from Felix Rieseberg's post "How to be more ambitious: A tutorial for humans with models" (13 October 2026). Speed means the same work in less time and needs no procedure, so this skill covers only Altitude, Depth, and Range. Credit the post when the user asks where the method comes from. Do not present the author's anecdotes or research citations as your own findings.
- **Scope guard: deeper, not bigger.** An expansion may change the inputs used, the methods applied, the target, and the proof required. It must not add deliverables the user did not ask for, widen the audience, or touch systems outside the task. A new index, migration, cache, scheduled job, or dependency counts as outside the task: list it under follow-ups and gate it on confirmation. If the rewrite would need a new deliverable, list it as an optional follow-up instead of folding it in.
- **Capture the request verbatim.** Keep the user's wording as the reference for every later check. Do not paraphrase it into notes.
- **Record any ceiling.** Words like "just", "only", "quick", "don't touch anything else", or "no new files" set a ceiling. A ceiling means no expansion: perform the task as asked and mention in one line that a deeper version exists.
- **Expansion trigger.** Expand only when the user asks for depth or ambition ("go deeper", "as good as you can", "why is the output shallow"), or the request names an outcome-type deliverable such as a report, deck, analysis, plan, audit, or performance goal. Every other request is bypassed. If a request meets both a trigger and a bypass condition, an explicit user request for depth wins; an outcome-type noun alone does not. A request to make something the user owns faster, cheaper, or smaller is a performance goal, not Speed (Speed is the assistant doing the user's work in less time). Routine debugging and bug fixes belong to `empirical-diagnostician`, and rewriting a prompt's wording belongs to `prompt-complexity-triage`, if those skills are installed; do not expand them here. When you hand a request to one of them, open with `Ambition check: bypassed (handed to <skill>)`.
- **Bypass check.** Skip Stages 2 to 5 and do the task exactly as asked when the trigger above is not met, or when any of these hold: the request is a single-step edit, lookup, rename, formatting change, or a question with a known answer; the work is trivial to redo and low in stakes; the user is mid-flow and the request is a continuation of a plan they already approved; or the request is a short, clear command such as "run the tests" or "commit this". If the request is empty or unintelligible, ask what it should accomplish instead. State the result as `Ambition check: bypassed (reason)` and proceed. If the thing the request names does not exist (a variable, file, or endpoint that cannot be found), search the named file (and one repository-wide search for the name), and if it is still not found, report that and ask what was meant instead of inventing an edit. Omit the bypass line in that case. A bypass for a trivial task needs no mention of a deeper version; a bypass caused by a user ceiling, or by a request that is outcome-shaped but met no trigger, gets the one-line mention. When you do expand, open with `Ambition check: expanding (reason)`. Bypass is the default for small tasks, because expansion has a cost in time, money, and the user's attention.
- **Environment check.** Depth and Range depend on the assistant having a computer: the ability to run commands, install a tool, and read the real data. Record which of these are available: shell, ability to install packages, read access to raw data (logs, database, exports, repository history), and a way to run a check. If something is missing, label the steps that need it `not run` in the rewrite instead of dropping them silently, and continue with what can be done. Stop and ask the user only when the missing access is the whole point of the expansion.

### Stage 2: Altitude (The Goal Beyond the Goal)
Climb from the task to the outcome it serves, and write the climb down.

- **Build a three-rung ladder.**
  1. **Base task:** what was literally requested.
  2. **Direct result:** the immediate use the user will make of it.
  3. **Outcome:** what the user wants to happen next, the durable change the task is a step toward.
- **Check that altitude fits.** Altitude works when there is an ultimate outcome that can be named in one sentence and eventually observed. If observing it needs data you cannot reach, still write the ladder and list that data as a missing prerequisite. It fits poorly for creative work whose value is the artifact itself. If the outcome cannot be named in one sentence, or the work is creative, stop at rung 2 and record `Altitude: not applicable (reason)`.
- **Name the prerequisites for a durable version.** Reaching a standing outcome, such as keeping something healthy rather than fixing it once, usually needs access that the single task did not: a data feed, a mapping between versions and commits, a place to reproduce and verify. List what is missing. Do not build or schedule anything recurring without the user's consent, and do not claim the outcome will be maintained when you have only done the task once.
- **Phrase the raised ask as questions to the data.** For example: what changed, why, and what should be done about it; or which few decisions are most urgent, with arguments for and against each; or what a better mechanism than the current artifact would be, validated against the user's own history. Keep the user's original deliverable as a deliverable.

### Stage 3: Depth (Raw Material, Methods, and Proof)
Rewrite the task the way a field-leading practitioner would approach it. A change of vocabulary is not a change of method; the method, inputs, and instruments must change.

- **Answer four questions in writing before rewriting.**
  1. **Expert gap:** what would a top professional do here that the request does not ask for?
  2. **Raw material:** what is the rawest input they would start from instead of what has been digested for the user? Name actual sources: query results, logs, schemas, exports, traces, repository history, seed data. Inspect what is actually available before naming it, and say if it is not.
  3. **Methods and tools:** the specific instruments, statistical tests, profilers, or design patterns, and why each applies. When the assistant reaches for a markdown table where a database or statistical model is the professional instrument, switch instruments or say why it cannot.
  4. **Outside evidence:** what other than the assistant or the user would show the result is right.
- **Set a demanding target, honestly.** Keep the user's stated target as the acceptance bar. Add a measurably harder number (for example a latency far below the stated one) labeled `stretch`, to force a structural rethink instead of a surface patch. If the user stated no target, propose one and label it `proposed`. Record both as targets, not promises, and report the number actually achieved.
- **Challenge assumptions with the raw data.** If the user states a belief the task depends on, add a step that tries to reproduce or refute it from the raw data before building on it.
- **Look for new knowledge only after the basics hold.** Once the data is understood, a second pass may look for a blind spot, such as an early signal nobody tracks, and must test any claim on data it was not fitted on.
- **Use the seed prompt when you need a quick rewrite.** This prompt from the source post produces the four answers above: "I want a deeper version of this task, not a bigger one. Before rewriting it: (1) say what a top professional in this field would do here that I'm not asking for; (2) name the rawest material they would start from instead of what has already been digested for me; (3) name the specific methods and tools they would use; (4) say what, other than you or me, would show the result is right. Then rewrite my prompt to ask for exactly that."

### Stage 4: Range (Methods From Adjacent Fields)
Bring in more fields than the task obviously needs, as methods rather than costumes.

- **Replace the noun with a verb.** Rewrite the deliverable as what it does for people. A quarterly deck becomes getting busy people to believe a story about cause and effect and to decide under uncertainty in thirty minutes. The verb exposes which fields matter.
- **Pick up to five lenses, and no more than have a real check.** Each lens is a professional discipline whose method applies, for example a statistician, a forensic accountant who reconciles totals, a short seller who looks for the weakest claim, an editor who cuts, a security engineer who attacks inputs. For each lens write the concrete check it performs and the artifact it produces. A lens with no concrete check is role-play: drop it, and use fewer lenses rather than padding to a count.
- **Do what the professional does; do not write like them.** Never ask for a persona voice. Ask for the procedure the professional runs.
- **Run the lenses inline by default.** Apply each lens as a pass over the work in this session. Spawning subagents is opt-in: do it only if the user asked for it or has agreed after seeing the cost, and use the `subagent-dispatch-economics` skill, if installed, to decide. Parallel agents multiply token cost and their results flow back into this session.
- **Require actionable findings.** Each lens ends with either a specific change made or a specific reason none was needed.

### Stage 5: The Rewritten Request and the Confirmation Gate
Show the rewrite before running it.

- **Produce the rewritten request in this form:**
  ```markdown
  ### Ambition Rewrite
  - **Original request (verbatim):** ...
  - **Goal ladder:** base task / direct result / outcome (or "Altitude: not applicable")
  - **Raw inputs to read:** ...
  - **Methods and instruments:** ...
  - **Lenses and the check each runs:** ...
  - **Target:** ...
  - **Outside judge:** the exact command, test, query, or reviewer (or "none available")
  - **Out of scope / optional follow-ups:** ...
  - **Cost and side effects:** time, tokens, installs, writes, anything hard to reverse
  ```
- **Confirmation rule.** Ask the user to confirm before executing when the rewrite widens the scope, costs materially more time or money, needs new access or installs, writes to anything outside the working files, reads large or sensitive data, or is hard to undo. If you are unsure whether a rewrite crosses one of these lines, ask. If it only sharpens method within the same scope at similar cost, state the rewrite and proceed. Never execute on the strength of the rewrite alone when the user has asked to review it first.
- **If the user cannot answer now** (a non-interactive run), stop at the gate and return the rewrite as the final output, marked `awaiting confirmation`. Do not execute.
- **If the user declines or narrows,** execute the original request with the accepted parts only and record what was dropped.

### Stage 6: Execute and Run the Outside Judge
Do the work, then verify it with something other than the assistant's own opinion.

- **Choose the judge in this order of preference:** (1) an executable check that returns a result: tests, a linter or type checker, a benchmark, a query on the raw data, a reconciliation of totals; (2) a held-out check, such as data the analysis was not fitted on; (3) a separate reviewer with fresh context, such as another model instance or an isolated review pass that sees only the output and the requirement; (4) the user, with the exact questions to answer.
- **Run it and show the output unedited.** Paste the command and an unedited excerpt of its pass/fail lines and totals; keep a long log out of the chat and offer it on request. Do not summarize a result you have not displayed.
- **Never grade your own work.** A statement such as "this looks correct" is not verification. Where the only available judge is yourself, the verdict is `UNVERIFIED: no external judge available`, followed by what would verify it.
- **Do not claim a deterministic pass unless a deterministic check ran.** Creative work and judgement calls usually have no deterministic judge. Say so, and offer a human review step instead of inventing a score.
- **On failure, fix and rerun** the same judge, up to three rounds. If it still fails, stop, report the failing output, and ask the user how to proceed. Do not change the judge to make it pass.

### Stage 7: Handoff
End with a short report the user can audit.

- **Report these items:** the goal ladder; the four answers; the lenses and what each found; the judge command and its unedited result; a list headed `Unverified`; trade-offs and decisions made; and the durable thing left behind, if any (a script, a test, a query, a checklist), with how to rerun it.
- **Say what remains manual.** If a recurring outcome needs a schedule, a credential, or another access that was not granted, name it as an open step rather than implying it is automated.

## Success Criteria
The procedure is complete when all of the following can be confirmed from the transcript:
- Either a bypass line with a reason was recorded, or the four written answers exist together with a goal ladder or an `Altitude: not applicable` note.
- The rewrite did not add a deliverable the user did not request.
- A confirmation was requested when the rewrite widened scope, cost, access, or risk.
- An outside judge ran and its unedited output is shown, or the result is explicitly labeled `UNVERIFIED: no external judge available`.
- Every lens recorded a concrete check, and no persona voice was used.

## Failure and Escalation
- If the user's goal is unclear or the outcome cannot be named, ask one clarifying question instead of guessing a higher goal.
- If the missing raw data or runner is the whole point of the expansion, stop, report what is missing, and ask the user whether to provide access or accept a reduced result. Otherwise label the affected steps `not run` and continue.
- If the judge fails three times, stop and hand the failing output to the user.
- If the rewrite is declined, perform the original request and do not re-argue.

## Prohibitions
- Never add deliverables, audiences, or systems the user did not ask for; expand depth, not size.
- Never expand a request that carries a ceiling or qualifies for bypass.
- Never use persona role-play in place of a method.
- Never spawn subagents without the user's agreement.
- Never grade your own work or claim a deterministic pass that did not run.
- Never edit the judge, the target, or the data to make a check pass.
- Never present the source post's anecdotes or citations as your own results.

## Worked Examples

### Example 1: Bypass on a small task
- **Input:** "Rename the variable `tmp` to `retry_count` in `worker.py`."
- **Action:** Record `Ambition check: bypassed (single-step edit)`, make the rename, and run the narrowest test or a syntax check.
- **Do not do:** Do not turn a rename into an audit of the module's error handling.

### Example 2: A deck request that has a real outcome
- **Input:** "Make the quarterly business review deck from these exports." The exports are in the working directory.
- **Action:** Climb the ladder (deck, then a decision-ready review, then problems caught early). Read the raw exports rather than the summary tab, restate the question as what changed, why, and what to do about it, and pick lenses such as an analyst who reproduces the headline numbers and a skeptic who attacks the weakest claim. Show the rewrite and confirm, because it reads every export and adds queries. List a new review mechanism under follow-ups instead of building it. Run a reconciliation query that checks every figure on the slides against the exports and show its output.
- **Verification:** The reconciliation output is pasted unedited. Slide copy quality, which has no deterministic judge, is marked `UNVERIFIED` and offered for human review.

### Example 3: Creative work, Altitude skipped
- **Input:** "Write a launch poem for our product, and make it as good as you can." (Without the second clause this is a low-stakes artifact that is trivial to redo, and it is bypassed: write the poem.)
- **Action:** The user asked for depth, so expand. Record `Altitude: not applicable (creative artifact)`. Apply Depth only to the craft, such as reading three existing poems the user likes as raw material, and confirm before doing more.
- **Verification:** No external judge exists. Report `UNVERIFIED: no external judge available` and ask the user to review the result.
