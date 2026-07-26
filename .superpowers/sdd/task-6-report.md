# Task 6 Report: Community Documentation, Agent Guidance, and Security Policy

## Implemented

- Added a concise public README covering requirements, install/update/uninstall, lifecycle behavior, configuration defaults, privacy and cost, Herdr limitations, security, troubleshooting, development, release, contribution, and licensing.
- Added AGENTS.md with the required lifecycle, source-of-truth, state reconstruction, subprocess, logging, failure isolation, TDD, and release invariants.
- Added contributor setup, RED/GREEN workflow, issue/PR evidence requirements, and compatibility template.
- Added security policy covering full user privileges, private GitHub Security Advisory reporting, supported versions, and a 90-day coordinated disclosure target.
- Added Keep a Changelog 0.1.0 history with compatibility floors and the standard MIT license for Tyler Folkman (2026).
- Added focused documentation-contract tests.

## TDD Evidence

### RED

`npm test -- test/docs.test.ts` failed because README.md and AGENTS.md did not yet exist.

### GREEN

`npm test -- test/docs.test.ts` passed: 2 tests.

## Validation

- `npm exec biome check -- README.md AGENTS.md CONTRIBUTING.md SECURITY.md CHANGELOG.md test/docs.test.ts` — passed.
- `npm test` — passed: 6 files, 40 tests.
- `npm run typecheck` — passed.
- `git diff --check` — passed.

## Blocked / Residual Validation

- `npm run check` — blocked by pre-existing formatting violations in `.pi-subagents/artifacts/*` metadata files; the focused changed-file Biome check passes.
- `npm pack --dry-run` — blocked because its `prepack` hook runs the same failing `npm run check`.
- `npm run verify:package` — blocked because `scripts/verify-package.mjs` is referenced by package.json but absent from this worktree.
- No live Herdr smoke test was run.

## Changed Files

- `README.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `LICENSE`
- `test/docs.test.ts`
- `.superpowers/sdd/task-6-report.md`

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Added only the seven files requested by Task 6 plus its report; documentation and contract test changes are scoped to community guidance."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "This report records changed files, tests, exact commands and outcomes, residual risks, and post-commit staged-state evidence."
    }
  ],
  "changedFiles": [
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "LICENSE",
    "test/docs.test.ts",
    ".superpowers/sdd/task-6-report.md"
  ],
  "testsAddedOrUpdated": [
    "test/docs.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm test -- test/docs.test.ts",
      "result": "passed",
      "summary": "2 documentation contract tests passed after implementation; initial RED run failed as expected before docs existed."
    },
    {
      "command": "npm exec biome check -- README.md AGENTS.md CONTRIBUTING.md SECURITY.md CHANGELOG.md test/docs.test.ts",
      "result": "passed",
      "summary": "Focused changed-file formatting and lint check passed."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "6 test files and 40 tests passed."
    },
    {
      "command": "npm run typecheck",
      "result": "passed",
      "summary": "TypeScript no-emit check passed."
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors."
    },
    {
      "command": "npm run check",
      "result": "failed",
      "summary": "Pre-existing .pi-subagents artifact metadata formatting violations are included by biome check .; focused changed-file check passes."
    },
    {
      "command": "npm pack --dry-run",
      "result": "failed",
      "summary": "prepack invokes the failing full npm run check."
    },
    {
      "command": "npm run verify:package",
      "result": "failed",
      "summary": "Referenced scripts/verify-package.mjs is absent from this worktree."
    }
  ],
  "validationOutput": [
    "Focused docs tests: 2 passed.",
    "Full tests: 40 passed.",
    "Typecheck and focused Biome checks passed."
  ],
  "residualRisks": [
    "Full repository check and package dry-run remain blocked by pre-existing .pi-subagents artifact formatting violations.",
    "Package verification remains unavailable because scripts/verify-package.mjs is absent.",
    "Live Herdr behavior was not smoke-tested."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added public README, agent and contributor guidance, security/changelog/license files, and documentation contract tests.",
  "reviewFindings": [
    "No blockers found in the focused documentation review; full check blockers are pre-existing repository artifacts and a missing referenced script."
  ],
  "manualNotes": "Commit the seven requested files and this report; parent review gate remains required."
}
```
