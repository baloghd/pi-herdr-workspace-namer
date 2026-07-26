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

- Config-root isolation gives each smoke its own socket/session namespace, so even a coincidentally identical session name cannot target another Herdr session.
- Live evidence covers Herdr 0.7.5 on this machine. Older or missing CLIs fail an explicitly requested smoke without touching active/default state.
- Biome 2.5.5 check output is clean, with no schema-version or deprecated-configuration notices.
- The unrelated scratch Task 6 report remains excluded from this fix wave and its commit.

## Temporary Pi Smoke Hang Follow-up (2026-07-26)

- Reproduced RED with `npm test -- test/extension.test.ts`: outside Herdr, the runtime registered all six lifecycle handlers, including `agent_settled`.
- Added runtime registration coverage proving the extension registers no handlers unless `HERDR_ENV=1`, while retaining the normal Herdr registration path.
- Moved the Herdr environment gate to the extension entry point. Outside Herdr the package now returns before lifecycle registration, so it cannot launch a title-model request after `agent_settled`.
- Focused test: `npm test -- test/extension.test.ts` — passed, 2 tests.
- Full check: `npm run check` — passed, 9 files / 55 tests, including typecheck.
- Package verifier: `npm run verify:package` — passed, 11 files / 34,536 bytes unpacked.
- Package dry run: `npm pack --dry-run` — passed, 11 files, 11.6 kB packed / 34.5 kB unpacked.
- Packed-install smoke: packed with `npm pack --json --ignore-scripts`, installed the tarball into a fresh temporary npm project, and verified `node_modules/pi-herdr-workspace-namer/extensions/workspace-namer.ts` exists — PASS.
- The original ambient command was rerun with a 45-second bound and still timed out after printing `OK`; a control run without this package timed out identically, showing an unrelated globally discovered extension remains live in the user's Pi configuration. This timed-out command is not counted as passed.
- Corrected isolated Pi smoke: `env -u HERDR_ENV timeout 45s pi --no-extensions -e "$PWD" -p 'Reply with OK only' --no-session` — PASS with output `OK` and exit status 0. Pi documents that explicit `-e` paths remain loaded under `--no-extensions`, so this exercises this package while excluding ambient extensions.

### Follow-up Changed Files

- `extensions/workspace-namer.ts`
- `test/extension.test.ts`
- `.superpowers/sdd/task-7-report.md`

### Follow-up Residual Risk

- An unrelated globally discovered Pi extension still keeps the ambient smoke process alive after output; package-isolated execution exits normally and is the attributable smoke result for this change.

## Final Review Fix Wave

- The live smoke now creates a unique temporary config root with `mkdtemp` and passes its `config.toml` through `HERDR_CONFIG_PATH` to session listing, the spawned server, adapter-backed commands, verification, and session cleanup. Ambient Herdr placement/socket variables are removed from the isolated environment.
- Tests preserve named-session collision and cleanup coverage while proving list/spawn/run/cleanup use the isolated config instead of an inherited default config. Temporary-root removal failure fails the smoke.
- Biome configuration now targets the installed 2.5.5 schema and uses `files.ignoreUnknown`, eliminating schema/deprecation notices while intentionally ignoring non-source artifacts.
- CI runs `npm run verify:package` before `npm pack --dry-run`.
- The README now describes config-root namespace isolation and accurately states that unsupported/missing Herdr fails an explicitly requested smoke rather than skipping successfully.
- Fresh final validation passed: focused live-smoke tests (8), full check (9 files / 57 tests, no Biome notices), package verification (11 files / 35,059 bytes), pack dry-run (11 files / 35.1 kB), and live Herdr 0.7.5 smoke in `pi-herdr-workspace-namer-smoke-V-hw7cfcks1ZF6wUR8_R6Q` with no temporary-root leak.
