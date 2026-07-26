# Task 7 Report: CI, Package Inspection, and Install/Live Smoke Verification

## Final Finding Fixes

- Live-smoke session names now contain a base64url encoding of `randomBytes(16)`, preserving 128 bits of randomness while remaining short enough for Herdr's Unix socket path limit.
- Before spawning, the smoke parses `herdr session list --json` (falling back to the plain table when JSON is unavailable), rejects listed candidate names, and retries up to 10 times.
- Cleanup ownership begins only after an absent name is selected and the child process successfully spawns. Exhausted collisions fail before spawn.
- Focused tests prove a listed existing session is neither stopped nor deleted, all-collision exhaustion does not spawn, and spawn failure does not trigger cleanup.
- The package verifier now has a subprocess-level unsafe fixture test that asserts a nonzero exit and the explicit absolute-home rejection diagnostic.

## TDD Evidence

### RED

`npm test -- test/live-smoke.test.ts` failed with 3 failures: the generated suffix had only 16 hex characters and `runUniqueLiveSmoke` did not exist. After adding the child-spawn ownership test, its first run failed because `runLiveSmoke` proceeded into readiness and cleanup instead of rejecting the spawn failure.

### GREEN

`npm test -- test/package.test.ts test/live-smoke.test.ts` passed after implementation. The focused suites cover 128-bit suffix shape, JSON collision parsing and retry, preservation of an existing colliding session, bounded exhaustion before spawn, ownership only after successful spawn, cleanup failure handling, verifier subprocess nonzero behavior, and absolute-home rejection.

## Fresh Validation Evidence (2026-07-26)

- Focused tests: `npm test -- test/package.test.ts test/live-smoke.test.ts` — passed.
- Full tests: `npm test` — passed, 8 files / 53 tests.
- Full check: `npm run check` — passed (Biome, TypeScript, and full tests).
- Package verifier: `npm run verify:package` — passed, 11 files / 34,674 bytes unpacked.
- Dry run: `npm pack --dry-run` — passed after its prepack check and verifier; 11 files, 11.6 kB packed / 34.7 kB unpacked.
- Guarded live smoke: `PI_HERDR_WORKSPACE_NAMER_LIVE=1 npm run test:live` — passed in `pi-herdr-workspace-namer-smoke-L85OC5h8prc4xeDXYqjQ6Q`; immediate listing showed no remaining smoke session.
- Diff hygiene: `git diff --check` — passed.

## Complete Task 7 Changed Files

- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.superpowers/sdd/task-7-report.md`
- `README.md`
- `biome.json`
- `scripts/live-smoke.mjs`
- `scripts/verify-package.mjs`
- `test/live-smoke.test.ts`
- `test/package.test.ts`

## Residual Risks

- The list-then-spawn sequence cannot atomically reserve a Herdr session name; 128-bit randomness makes a concurrent post-check collision negligible, and cleanup is restricted to a candidate observed absent before successful spawn.
- Live evidence covers Herdr 0.7.5 on this machine. Older CLIs without isolated named-session support are skipped without touching active/default state.
- Biome emits informational schema-version and deprecated-configuration notices; these do not fail checks.
- The unrelated pre-existing unstaged `.superpowers/sdd/task-6-report.md` change remains excluded from Task 7 and its commit.
