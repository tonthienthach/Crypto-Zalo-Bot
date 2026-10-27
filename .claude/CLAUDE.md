<!-- aidlc:codegraph:start -->
## codegraph (managed by AIDLC extension — do not edit by hand)

This project has a CodeGraph index at `.codegraph/`, exposed via the
`codegraph` MCP server (auto-registered by the AIDLC VS Code extension). The
server watches the project and re-syncs changed files within a couple of
seconds, so the graph reflects edits made in this session too.

**Prefer `codegraph_explore` over grep/read sweeps when the question is
structural** — "how does X work", "who calls X", "how does X reach Y", "what
breaks if I change X". One call returns the relevant symbols' source grouped by
file, the call paths between them, and a blast-radius summary.

AIDLC skills and agents may name **ast-graph** tools. This workspace uses
codegraph instead — map them:
- ast-graph `symbol` / `search` → `codegraph_explore` naming the symbol
- ast-graph `blast-radius` / `changed-symbols` → `codegraph_explore` (its blast-radius section)
- ast-graph `hotspots` / `routes` / `dead-code` → `codegraph_explore` on the area in question

Keep using grep/read/edit for editing, config files, prose, and non-code signals.

If the index looks missing or stale, ask the user to run `AIDLC Native: Rescan AST Graph`.
<!-- aidlc:codegraph:end -->
