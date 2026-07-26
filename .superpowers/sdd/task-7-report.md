# Task 7 Report: CI, Package Inspection, and Install/Live Smoke Verification

## Reviewer Finding Fixes

- The live smoke now generates `pi-herdr-workspace-namer-smoke-<random>` with a 128-bit random suffix for each invocation.
- A successful server spawn immediately establishes cleanup ownership, before readiness polling.
- Owned sessions always receive both `session stop` and `session delete` attempts, including readiness and adapter failures.
- Cleanup errors fail the smoke. When the operation and cleanup both fail, the final error includes the primary failure followed by the cleanup failure.
- The live runner is importable and injectable for focused process-free tests.
- The package inspector is importable for negative allowlist, unsafe-directory, oversize, session-artifact, and missing-runtime tests.
- README now documents unique disposable sessions and cleanup-failure behavior.

## TDD Evidence

### RED

`npm test -- test/package.test.ts test/live-smoke.test.ts` failed as expected: 4 failed and 3 passed. The live module exited during import, `inspectPackage` was not exported, and cleanup behavior was not injectable.

### GREEN

`npm test -- test/package.test.ts test/live-smoke.test.ts` passed: 2 files and 8 tests. The new tests prove readiness failure still attempts stop and delete, a delete failure preserves the readiness error and fails the run, cleanup failure also fails an otherwise successful smoke, unique suffixes are applied, unsafe/nonallowlisted/oversized/session paths are rejected, and a package without runtime modules is rejected.

## Previous Task 7 Run Evidence (2026-07-26)

- `npm run check` — passed: Biome checked 19 files, TypeScript passed, and Vitest passed 7 files / 44 tests.
- `npm run verify:package` — passed: `package verified: 11 files, 34668 bytes unpacked`.
- `npm pack --dry-run` — passed after prepack reran check and verification; tarball listed 11 files, 11.6 kB packed, and 34.7 kB unpacked.
- Packed install command using `npm pack --json --ignore-scripts`, a temporary npm project, and `npm install --ignore-scripts` — passed: `packed install verified: node_modules/pi-herdr-workspace-namer/extensions/workspace-namer.ts`.
- `PI_HERDR_WORKSPACE_NAMER_LIVE=1 npm run test:live` — passed in the then-fixed disposable session `pi-herdr-workspace-namer-smoke`; the subsequent `herdr session list --json` did not list that session.
- `timeout 60s pi --no-extensions -e "$PWD/extensions/workspace-namer.ts" -p "Reply with OK only" --no-session` — passed with `OK` and exit 0. Earlier broader Pi invocations loaded user extensions and timed out after printing `OK`; the isolated extension-only invocation is the successful Pi smoke evidence.

## Fresh Validation Evidence (2026-07-26)

- `npm run check` — passed before the final cleanup-success test was added: Biome checked 20 files, TypeScript passed, and Vitest passed 8 files / 48 tests. The final rerun passed 8 files / 49 tests.
- `npm run verify:package` — passed: `package verified: 11 files, 34674 bytes unpacked`.
- `npm pack --dry-run` — passed after prepack reran the full check and verifier; tarball listed 11 files, 11.6 kB packed, and 34.7 kB unpacked.
- Packed install command using `npm pack --json --ignore-scripts`, a temporary npm project, and `npm install --ignore-scripts` — passed; both the extension and `src/lifecycle.ts` existed.
- `PI_HERDR_WORKSPACE_NAMER_LIVE=1 npm run test:live` — passed in unique session `pi-herdr-workspace-namer-smoke-79314b506a81740c`; the immediate session list confirmed it was deleted.
- `timeout 60s pi --no-extensions -e "$PWD/extensions/workspace-namer.ts" -p "Reply with OK only" --no-session` — passed with `OK` and exit 0.
- `git diff --check` — passed.

## Changed Files

- `scripts/live-smoke.mjs`
- `scripts/verify-package.mjs`
- `test/live-smoke.test.ts`
- `test/package.test.ts`
- `README.md`
- `.superpowers/sdd/task-7-report.md`

## Residual Risks

- Live Herdr evidence covers the installed Herdr version on this machine; the guarded smoke skips older CLIs without isolated named-session support.
- Biome reports informational schema/deprecation notices because the installed CLI is newer than the configured schema; checks still pass.
- The pre-existing unstaged `.superpowers/sdd/task-6-report.md` change is unrelated and remains excluded from this task.
