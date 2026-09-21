---
description: AIDLC dispatcher — run a phase for an epic, or the next eligible phase. Usage: /aidlc <epic> [phase]
---

# AIDLC dispatcher

You were invoked as `/aidlc <epic> [phase]` with arguments: `$ARGUMENTS`.
The first token is the **epic id**; an optional second token is the **phase**.

## 1. Bind the epic to its pipeline

1. Read `docs/epics/<epic>/state.json`. Note `pipelineId` (the pipeline this
   epic is bound to) and the per-step `status` list. If the file is missing,
   tell the user the epic isn't started and stop.

## 2. Choose the phase

- **If a phase was given**, use it. Validate it is a step in the epic's
  pipeline (see step 3). If it isn't, tell the user which phases the pipeline
  *does* have and stop.
- **If no phase was given**, pick the **next eligible phase**: the first step
  that is `awaiting_work`, else the first `rejected` step, else the first
  `pending` step whose every `depends_on` is `approved`. If none is
  actionable (all approved or paused for review), say so and stop.

## 3. Resolve composition from the pipeline (never from the command name)

1. Read `.aidlc/workspace.yaml`. Find the pipeline whose `id` === `pipelineId`.
2. In that pipeline's `steps`, find the step whose `name` (or `agent` when
   unnamed) === the chosen phase. That step's `agent` + `skills` are the
   wiring. If the step omits `skills`, use the referenced agent's `skills:`.
3. Load the persona from `.claude/agents/<agent>.md` (fall back to
   `~/.claude/agents/<agent>.md`), and each skill from
   `.claude/skills/<skill>.md` (fall back to `~/.claude/skills/<skill>.md`).
   Adopt the persona and follow the skill instructions.

If the active SDLC standard (`standard:` in workspace.yaml, or a per-epic
override) is `none`, skip the persona/skill (opinion) layer and act as plain
Claude — but still follow the structural contract below.

## 4. Structural contract (always applies, every profile)

1. Read `docs/epics/<epic>/state.json` for prior feedback/history and address
   any rejection reasons in this revision.
2. Read `docs/epics/<epic>/inputs.json` for capability inputs.
3. Before writing, read the blank template for that artifact at
   `.aidlc/aidlc-templates/<templatesId>/<FILE>` and follow its structure —
   `<templatesId>` is the pipeline's `derived_from` when it has one (a
   recipe-assembled pipeline is named after its epic and has no templates of
   its own), else its `id`. Skip this if no such file exists.
4. Write your output to `docs/epics/<epic>/artifacts/<FILE>` where `<FILE>`
   is the step's declared artifact, or the phase's conventional file. The AIDLC
   validator checks this path when the step is marked done. The folder starts
   empty — a file in it is one an agent wrote, never a placeholder.
5. Summarize what you produced and tell the user to click **"Mark step done"**
   in the AIDLC panel to advance the pipeline.

## Output language

Read `artifact_language` from `.aidlc/workspace.yaml`. If it is set, write
this phase's artifact in that language and follow the rest of this section.
If it is absent, ignore this section and use your normal judgement.

This governs the prose you author: problem statements, rationale, acceptance
criteria, open questions, table cells, commit-message bodies, and the summary
you give the user at the end.

It does **not** govern the document skeleton. Leave these exactly as the
template has them, in English:

- Markdown headings and their numbering (`## 1. Problem`). AIDLC generates and
  matches these strings — a translated heading is a section the pipeline can no
  longer find.
- Field labels (`**Epic ID:**`, `**Status:**`) and table column names.
- File names, paths, identifiers, code, API routes, and any value quoted from
  the codebase.

The test: diffing your artifact against its template should show a change in
the prose and nowhere else.

## Depth of work

Read `strict_mode` from this epic's `state.json`. If it is absent or
`true`, ignore this section and work at your normal depth. If it is
`false`, match the artifact to the size of the work: cover what this
change actually needs, and stop there.

Under a relaxed depth:

- Keep every heading the template has, in the same order. The auto-reviewer
  and the traceability validator match on those exact strings — a section
  you delete for brevity is a gate you fail.
- A section with nothing real to say gets **one line**: what does not apply
  and why (`No new persistence — reuses the existing table.`). Do not invent
  content to fill a heading.
- Raise a non-functional concern — performance, security, scalability,
  migration, rollback, observability — only when this change actually moves
  it, or when the brief or the code you read raises it. Say it in one or two
  sentences under the heading it belongs to; it does not need a sub-analysis.
- Skip alternatives-considered and risk registers unless a decision here is
  genuinely contested. One sentence on why the obvious approach was taken is
  enough when it is not.
- Prefer the specific to the exhaustive: the file, the endpoint, the table,
  the acceptance criterion someone can test. Three concrete criteria beat
  twelve generic ones.

This is a budget on breadth, never on correctness. Do not skip reading the
code you are about to change, do not guess at an interface you could look
up, and do not leave out something the next phase needs — a shorter artifact
that sends the phase after it back to ask is not shorter.
