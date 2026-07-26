# Task 4 Report

## Evidence

- Added `src/herdr.ts` with an argv-only injected executor adapter, strict response parsing, explicit-workspace rename and verification, bounded/sanitized failures, and a file-based concurrent writer lock.
- The adapter resolves the pane before locking and again inside the lock. If placement changed, it releases the old workspace lock, locks the new workspace, and re-resolves again before renaming. Movement is bounded to avoid an infinite loop.
- Lock ownership uses unique tokens, exclusive creation, ownership-aware cleanup, a heartbeat for active operations, a two-second acquisition deadline, and conservative stale-lock reclamation after ten seconds.
- Added `test/herdr.test.ts` with eight tests covering exact argv/timeouts, malformed JSON fail-closed behavior, verification mismatch, moved-pane re-resolution, concurrent critical-section serialization, stale/live lock behavior, bounded errors, and real executable argv safety.
- Added executable `test/fixtures/fake-herdr.mjs`; the subprocess test invokes it with `execFile` semantics and proves shell metacharacters remain one title argument.
- TDD RED: `npm test -- test/herdr.test.ts` failed because `src/herdr.ts` did not exist.
- Focused GREEN: `npm test -- test/herdr.test.ts` passed (8 tests).
- Full suite: `npm test` passed (26 tests across 4 files).
- Type validation: `npm run typecheck` passed.
- Focused formatting/lint: `npx biome check src/herdr.ts test/herdr.test.ts test/fixtures/fake-herdr.mjs` passed.
- Whitespace validation: `git diff --check` passed.

## Self-review

- No command string concatenation or shell option is present; command and title are sent as separate argv values.
- Raw title, stdout, and stderr are not reflected into failures. Codes and messages pass through a 160-character, control-whitespace-sanitizing bound.
- Workspace IDs are validated before being used as lock filenames.
- Rename and verification remain inside the same workspace-specific lock, and no rename is retried after verification failure.
- No implementation or test files were staged before the requested commit step.

## Concerns

- Stale-lock reclamation is necessarily advisory on filesystem locks. Ownership tokens and heartbeat reduce replacement/active-owner deletion risk, but process pauses longer than ten seconds on filesystems with unusual cache/mtime behavior remain a residual limitation.
- `npm run check` is not a useful repository-wide signal because Biome scans pre-existing `.pi-subagents/artifacts/*.json` files and reports their formatting. Focused Biome, the complete test suite, typecheck, and `git diff --check` all pass.

## Task 4 Lock TOCTOU Follow-up

- Reworked stale and owner cleanup to atomically move the candidate lock to a unique quarantine path, validate its token and metadata, and remove it only when ownership is still proven. A changed candidate is restored with a no-replace hard link, so a replacement lock is never deleted.
- Added deterministic race tests in `test/herdr.test.ts` for replacement installation after stale inspection and replacement installation during owner release. The Herdr-focused suite now passes 10 tests.
- Verification: `npm test` passed (28 tests across 4 files); `npm run typecheck` passed; `npx biome check src/herdr.ts test/herdr.test.ts test/fixtures/fake-herdr.mjs` passed; `git diff --check` passed.
- Review finding: no blockers identified. Residual risk remains the advisory nature of stale recovery if a process is paused beyond the ten-second stale threshold or if filesystem timestamp semantics are unusual.
