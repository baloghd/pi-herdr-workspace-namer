# Pi Herdr Workspace Namer Design

**Date:** 2026-07-26  
**Status:** Approved  
**Repository:** `tfolkman/pi-herdr-workspace-namer`  
**npm package:** `pi-herdr-workspace-namer`

## Purpose

Provide a community-ready Pi package that keeps the current Herdr workspace label aligned with the active Pi session's task. Tyler primarily navigates agents through Herdr workspaces, so concise task-oriented workspace labels are more valuable than cwd-derived repo labels.

## Goals

- Generate a concise task title once per new Pi session using the current Pi model.
- Persist that title as the native Pi session name.
- Mirror the Pi session name to the current Herdr workspace.
- Follow Pi sessions across `/new`, `/resume`, and `/fork` without periodic polling.
- Mirror later manual Pi `/name` changes.
- Publish as an easy-to-install GitHub and npm Pi package listed in the Pi package gallery.
- Fail safely outside Herdr or when optional integration operations fail.

## Non-goals

- Rename Herdr panes or tabs.
- Rename Git branches or worktrees.
- Display Pi subagents as Herdr panes.
- Infer task changes continuously within one Pi session.
- Bidirectionally synchronize manual Herdr workspace renames back into Pi.
- Restore a Herdr workspace from a custom label to cwd-derived automatic naming; Herdr 0.7.5 has no public reset API.

## User-visible behavior

### New unnamed session

1. Capture the first meaningful interactive or RPC prompt.
2. Let the normal Pi turn complete.
3. After `agent_settled`, make one concise-title request using the active Pi model.
4. Validate and normalize the model response; use a deterministic local fallback if generation fails.
5. Save the title through `pi.setSessionName(title)`.
6. Resolve the pane's current Herdr workspace and rename it to the title.

Example:

```text
Research how to correctly auto-name Herdr workspaces from Pi
→ Research Herdr Workspace Naming
```

### Existing named session at startup or `/resume`

Use the saved Pi session name immediately. Rename the current Herdr workspace without another model request.

### `/new`

Pi creates a distinct session. Its first meaningful completed turn generates one new title and replaces the current workspace label.

### `/fork`

The fork has a distinct session ID. It inherits conversation history but generates a new title from the first new prompt submitted in the fork.

### Manual Pi `/name`

`session_info_changed` mirrors the new Pi session name to Herdr. The active Pi session always owns the current workspace label.

### Subsequent prompts

Do not generate another title. There are no timers or periodic checks. To begin a separately named task, use `/new`; use `/name` for an explicit correction.

## Authority model

The Pi session name is the sole source of truth. The Herdr workspace label is a one-way derived navigation label.

Per approved policy, the active Pi session always replaces the workspace label. Manual Herdr-only renames are not preserved when Pi next synchronizes its session name. Manual Pi `/name` changes are preserved and propagated.

Herdr's `workspace.rename` sets `Workspace.custom_name`, which stops cwd-derived automatic naming. Herdr 0.7.5 exposes neither name provenance nor a reset-to-auto API. The package must document this clearly.

## Architecture

### Extension entry point

`extensions/workspace-namer.ts` registers Pi lifecycle handlers and composes four focused modules.

### Naming module

`src/naming.ts`:

- Builds the constrained naming prompt.
- Calls the current Pi model using supported Pi model/auth APIs.
- Requires 3–6 task-oriented words and a maximum of 48 Unicode code points.
- Removes wrapping quotes, markdown, control characters, and commentary.
- Falls back to a deterministic local title derived from the first prompt.
- Never logs or persists provider credentials.

The naming call sends the first task prompt to the same provider already configured for the active Pi model. This incurs one additional model request per new/forked session. README must disclose privacy, latency, and cost implications.

### Pi lifecycle module

`src/lifecycle.ts`:

- `session_start`: reconstructs state from active-branch custom entries. If a native Pi session name exists, schedules an immediate Herdr synchronization.
- `input`: captures the first meaningful prompt when source is `interactive` or `rpc`; ignores extension-generated input, blanks, steering, follow-ups, and extension commands.
- `before_agent_start`: records expanded prompt fallback where raw input was a skill/template invocation.
- `agent_settled`: generates and persists the title once after Pi has no retry, compaction, or queued continuation remaining.
- `session_info_changed`: synchronizes native Pi name changes to Herdr, while suppressing duplicate handling of the extension's own `setSessionName` call.
- `session_shutdown`: releases in-memory resources and pending work.

Do not use `agent_end` as a completion boundary.

### Herdr adapter

`src/herdr.ts`:

- Requires `HERDR_ENV === "1"`.
- Uses `pi.exec` with executable and argument arrays; never invokes a shell.
- Runs `herdr pane current --current` before each mutation so a moved pane targets its current workspace rather than stale launch-time environment IDs.
- Parses returned JSON and extracts `workspace_id`.
- Calls `herdr workspace rename <workspace-id> <title>` with a bounded timeout.
- Re-reads `herdr workspace get <workspace-id>` and verifies the exact label.
- Treats missing Herdr, unavailable socket, closed workspace, malformed JSON, or timeout as nonfatal integration failures.

### State module

`src/state.ts` stores append-only custom entries under a versioned type such as `pi-herdr-workspace-namer/v1`.

Records include:

```ts
{ v: 1, kind: "candidate", sessionId, prompt, at }
{ v: 1, kind: "named", sessionId, title, at }
{ v: 1, kind: "sync-started", sessionId, title, workspaceId?, at }
{ v: 1, kind: "sync-finished" | "sync-failed", sessionId, title, workspaceId?, at }
```

Reconstruction reads `ctx.sessionManager.getBranch()` and accepts only records matching the current session ID. Copied parent records therefore do not suppress a fork's naming operation.

A process-local mutex prevents duplicate hooks in one Pi runtime. A short per-workspace filesystem lock prevents simultaneous Pi panes from issuing interleaved renames. Last activated/resumed session wins once the lock is acquired.

## Meaningful prompt policy

A prompt is eligible when:

- source is `interactive` or `rpc`;
- `streamingBehavior` is absent;
- normalized text is nonempty;
- it is not an extension command;
- it contains task-bearing text after skill/template expansion.

Images without text do not trigger naming in v1. Slash commands handled by Pi extensions never reach `input`. Skill/template invocations use their expanded `before_agent_start` prompt as fallback.

## Configuration

Optional package settings under `herdrWorkspaceNamer`:

```json
{
  "herdrWorkspaceNamer": {
    "enabled": true,
    "maxLength": 48,
    "fallback": "local",
    "notifyOnError": true
  }
}
```

Defaults require no configuration. Unknown or invalid values fall back safely. The initial release does not add a second-model selector; it always uses the active Pi model as approved.

## Error handling

- Naming failure: use deterministic local fallback.
- No active model/auth: use local fallback.
- Herdr unavailable/outside Herdr: preserve Pi session naming and skip workspace sync.
- Herdr command failure: append failure state; optionally notify once; never block or fail the Pi turn.
- Verification mismatch: report concise warning and stop; no retry loop.
- Reload after uncertain external outcome: native Pi session name remains authoritative; next `session_start` may safely reapply the same idempotent workspace label.
- Never expose raw provider errors, prompt contents, credentials, or unbounded Herdr stderr in notifications.

## Public package layout

```text
pi-herdr-workspace-namer/
├── extensions/workspace-namer.ts
├── src/{naming,herdr,lifecycle,state,config}.ts
├── test/{naming,herdr,lifecycle,state}.test.ts
├── docs/superpowers/specs/
├── AGENTS.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── tsconfig.json
└── .github/workflows/ci.yml
```

## Pi package and gallery requirements

`package.json` will include:

- name `pi-herdr-workspace-namer`;
- MIT license;
- repository and issue URLs;
- keywords including `pi-package`, `pi-extension`, and `herdr`;
- explicit `pi.extensions` manifest;
- Pi core imports as `peerDependencies` with `"*"` ranges;
- package `files` allowlist;
- current Node engine requirement;
- scripts for typecheck, tests, lint/format checks, and package verification.

The `pi-package` keyword makes the npm package eligible for `pi.dev/packages`. A later image or MP4 demo can be added through Pi gallery metadata without changing runtime behavior.

Installation:

```bash
pi install npm:pi-herdr-workspace-namer
```

Update:

```bash
pi update pi-herdr-workspace-namer
```

GitHub and npm tags must use matching semantic versions.

## Community documentation

### README

Cover:

- concise problem/benefit statement;
- supported Pi and Herdr versions;
- install, update, uninstall, and configuration;
- lifecycle table for startup/new/resume/fork/name;
- current-model request cost/privacy disclosure;
- Herdr custom-name limitation;
- troubleshooting and diagnostics;
- trust warning that Pi packages execute with full user privileges;
- development and release links.

### AGENTS.md

Give coding agents concise repository-specific instructions:

- architecture and source-of-truth invariant;
- required official Pi/Herdr docs and pinned compatibility points;
- lifecycle constraints (`agent_settled`, active branch, session ID scoping);
- subprocess and secret-safety constraints;
- TDD and verification commands;
- package/release checks;
- single-writer expectations and no unrelated refactors.

### CONTRIBUTING and SECURITY

Document local setup, issue/PR expectations, compatibility reports, responsible vulnerability reporting, and the full-system-access security model of Pi packages and Herdr plugins/extensions.

## Testing

### Unit tests

- Local title normalization and fallback.
- Model output validation and fallback paths.
- One naming call per session ID.
- Existing Pi names cause sync without model call.
- Second prompt does not rename or call model.
- `/new`, `/resume`, and `/fork` state transitions.
- Manual `session_info_changed` propagation.
- Active-branch reconstruction excludes abandoned branch records.
- Child/fork session IDs do not inherit completion state.
- Herdr JSON parsing, moved-pane workspace resolution, timeout, nonzero exit, malformed output, and verification mismatch.
- Argument-array execution prevents shell interpolation.
- Duplicate hook and concurrent writer protection.

### Integration tests

- Fake executable fixtures for deterministic CI.
- Optional live Herdr smoke test, excluded by default and guarded by explicit environment variable.
- Package install smoke test using Pi's temporary extension mode where practical.

### Release gates

- Typecheck.
- Unit/integration tests.
- Lint/format check.
- `npm pack --dry-run` inspection.
- Test packed tarball installation.
- Verify package contains no secrets, local paths, logs, sessions, or unrelated artifacts.
- Verify README commands against the packed package.

## CI and maintenance

GitHub Actions runs supported Node versions on Linux, with macOS added if needed for a live Herdr compatibility check. Dependabot maintains npm and Actions dependencies. Releases use npm provenance and require npm 2FA. Changelog and package version update together.

Compatibility code must feature-detect Pi APIs where possible and fail closed with concise diagnostics. Minimum supported Pi/Herdr versions will be pinned after implementation tests against the installed baseline: Pi 0.82.1 and Herdr 0.7.5.

## Success criteria

- A user can install from npm with one Pi command.
- First task in a new Pi session produces one concise native session name and matching Herdr workspace label.
- No further model call occurs in that session.
- `/new`, `/resume`, `/fork`, and `/name` follow documented behavior.
- Failures never break normal Pi usage.
- Automated tests cover lifecycle, persistence, subprocess safety, and Herdr failures.
- Public repository includes complete contributor, agent, security, package-gallery, and release documentation.
