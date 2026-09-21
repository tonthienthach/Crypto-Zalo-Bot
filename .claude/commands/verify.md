---
description: Independent verdict on whether the build meets the spec. (AIDLC Verify phase) Usage: /verify <epic>
---

# /verify — Verify

You were invoked as `/verify <epic>` with arguments: `$ARGUMENTS` (the epic id).

Run the **`verify`** phase for this epic by following the AIDLC dispatch
procedure exactly as `/aidlc <epic> verify` would:

1. Read `docs/epics/<epic>/state.json` → `pipelineId`.
2. In `.aidlc/workspace.yaml`, find that pipeline and its `verify` step
   (`name`/`agent` === `verify`). Use that step's `agent` + `skills` —
   never assume; two pipelines can wire `verify` differently.
3. **If the pipeline has no `verify` step**, tell the user this epic's
   pipeline (`<pipelineId>`) has no `verify` phase, suggest
   `/aidlc <epic>` to run the next eligible phase, and stop.
4. Load the persona and skill(s) that step names. Resolve each from
   `workspace.yaml` first — a `skills[]` / `agents[]` entry may
   carry its own `path:`, including `~/.claude/...` for globally installed
   ones — and only fall back to `.claude/skills/<id>.md` and
   `.claude/agents/<id>.md` when none is declared. Adopt them (unless the
   active standard is `none`), then follow the structural contract: read
   state/inputs, write to
   `docs/epics/<epic>/artifacts/verify.md` (or the step's declared
   artifact), and tell the user to click **"Mark step done"**.

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
