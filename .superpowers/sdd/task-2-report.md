# Task 2 Report: AI Title Generation and Deterministic Fallback

## Changed files
- `src/naming.ts` — added title normalization, deterministic prompt fallback, and injected-completion title generation.
- `test/naming.test.ts` — added five Vitest cases for normalization, fallback sanitization, model success, and provider failure fallback.

## Commands and output
- `npm test -- test/naming.test.ts` (RED) — failed during collection because `src/naming.ts` did not exist.
- `npm test -- test/naming.test.ts` (GREEN) — 5 tests passed.
- `npm exec -- biome check --write src/naming.ts test/naming.test.ts` — formatting applied successfully.
- `npm test -- test/naming.test.ts` — 5 tests passed.
- `npm run typecheck` — passed.
- `npm test` — 2 test files, 7 tests passed.
- `npm exec -- biome check -- src/naming.ts test/naming.test.ts` — passed.
- `git diff --check` — passed.
- `git status --porcelain=v1` after implementation commit — clean before this report was written.

## Commit
- `30aeb1888e866f7a1c9f8e8322548bc7a0747132` — `feat: add bounded AI task title generation`

## Self-review
- Model completion is attempted exactly once and provider errors are not propagated.
- Model output is normalized and bounded by Unicode code point count.
- Fallback removes path/URL and command-like punctuation, filters stop words, and uses deterministic title casing.
- Newline-containing/commentary responses are rejected before model acceptance.
- No lifecycle/provider integration was added; scope is limited to the requested naming interface.

## Concerns
- The brief's sample expects a 31-code-point title while passing `maxLength = 30`; strict code-point truncation therefore produces `Research Herdr Workspace Namin`. The test records the strict bounded result rather than adding a phrase-specific overflow exception.
- This report is intentionally written after the implementation commit and is not staged.

## Reviewer-finding fixes
- Added regression coverage for empty and invalid model output, U+2028/U+2029 separators, astral code-point bounds, relative/Windows path tokens, shell flags, and backtick code spans.
- `normalizeTitle` now rejects U+2028 and U+2029 before whitespace normalization.
- `fallbackTitle` removes backtick code spans and drops every whitespace token containing `/` or `\\`, plus flag tokens beginning with `-`.

## Fix verification
- `npm test -- test/naming.test.ts` — 10 tests passed.
- `npm run typecheck` — passed.
- `npm exec -- biome check -- src/naming.ts test/naming.test.ts` — passed.
- `npm test` — 2 test files, 12 tests passed.
- `git diff --check` — passed.
