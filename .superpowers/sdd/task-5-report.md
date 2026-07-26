# Task 5 Report: Pi Lifecycle State Machine and Runtime Extension

## Implemented

- Added `registerWorkspaceNamer(pi, dependencies)` with explicit per-session runtime state.
- Reconstructs only current-session records from the active branch.
- Captures eligible interactive/RPC prompts and expanded skill/template prompts.
- Generates a title once after `agent_settled`, persists lifecycle records, sets the native Pi session name, and synchronizes Herdr.
- Suppresses the matching `session_info_changed` event caused by the extension's own name update while mirroring later native/manual changes.
- Serializes synchronization through a promise queue and guards all queued/in-flight mutations against session replacement.
- Contains both returned and thrown Herdr failures, emits only a generic warning when configured and UI is available, and never exposes prompt/stderr details.
- Added the runtime adapter using the active Pi model and exactly one `completeSimple` call per generated title.

## Pi 0.82.1 Type Verification

Verified installed declarations in:

- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts`
- `node_modules/@earendil-works/pi-ai/dist/index.d.ts`
- `node_modules/@earendil-works/pi-ai/dist/compat.d.ts`
- `node_modules/@earendil-works/pi-ai/package.json`

The installed `@earendil-works/pi-ai` 0.82.1 package does not export `completeSimple` from its root entry point. Its declared and exported compatibility entry point is `@earendil-works/pi-ai/compat`, so the adapter imports from that path. Official `ExtensionAPI`, `ExtensionContext`, event, session manager, model registry auth, and UI notification shapes are used.

## TDD Evidence

### RED

`npm test -- test/lifecycle.test.ts`

Failed because `../src/lifecycle.ts` did not exist.

### GREEN

`npm test -- test/lifecycle.test.ts`

Passed 10 lifecycle tests, including generation-once behavior, resumed names, fork isolation, own-event suppression/manual mirroring, input filtering, expanded skill fallback, returned/thrown Herdr failures, generation replacement guards, and serialized queue replacement guards.

## Final Validation

- `npm test` — passed: 5 files, 38 tests.
- `npm run typecheck` — passed.
- `npm exec -- biome check extensions src test` — passed.
- `git diff --check` — passed.

## Changed Files

- `src/lifecycle.ts`
- `extensions/workspace-namer.ts`
- `test/lifecycle.test.ts`
- `.superpowers/sdd/task-5-report.md`

## Residual Risks

- No automated live-provider or live-Herdr integration was run; runtime integration is covered through injected lifecycle tests and the existing Herdr test suite.
