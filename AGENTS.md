# AGENTS.md

## Source of truth

Pi session name is authoritative. Herdr workspace label is derived one-way.

## Required references

Before changing lifecycle code, read the installed Pi `docs/extensions.md` and the matching version's extension types. Before changing Herdr behavior, read Herdr's matching tagged `SKILL.md`, workspace CLI/API schema, and workspace implementation.

## Invariants

- Herdr-only package: the extension must return before registering handlers outside Herdr, with no Pi naming, model call, state write, or Herdr command.
- Generate at most once per Pi session ID.
- Use `agent_settled`, never `agent_end`, for naming completion.
- Reconstruct only from `ctx.sessionManager.getBranch()` and scope records by current session ID.
- Resolve placement with `herdr pane current --current` before every rename.
- Execute Herdr through `pi.exec` with argument arrays; never use `sh -c` or string interpolation.
- Never log prompts, provider credentials, raw model failures, or unbounded stderr.
- Never rename panes, tabs, branches, or worktrees.
- Failures must not fail the Pi turn.

## Development

Use test-driven development: add a failing focused test first, observe RED, implement minimally, then verify GREEN. Run `npm run check` before claiming completion. Run `npm pack --dry-run` and `npm run verify:package` before release. Keep one writer in the active worktree and avoid unrelated refactors.
