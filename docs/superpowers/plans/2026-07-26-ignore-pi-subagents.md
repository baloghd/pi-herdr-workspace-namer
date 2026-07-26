# Ignore Pi Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Pi subagent child sessions from renaming their parent Herdr workspace.

**Architecture:** Extend the existing entry-point environment gate to exclude processes explicitly marked `PI_SUBAGENT_CHILD=1`. Test the boundary at extension registration, then release a patch through protected `main`.

**Tech Stack:** TypeScript, Vitest, npm, GitHub Actions, Pi extension API.

## Global Constraints

- Remain inert outside `HERDR_ENV=1`.
- Remain inert when `PI_SUBAGENT_CHILD=1`.
- Do not filter names such as `subagent-worker`; trust the explicit environment contract.
- Do not alter parent-session lifecycle behavior.
- Release through a pull request because `main` is protected.

---

### Task 1: Exclude subagent child processes

**Files:**
- Modify: `test/extension.test.ts`
- Modify: `extensions/workspace-namer.ts`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `PI_SUBAGENT_CHILD=1`, emitted by `pi-subagents` child processes.
- Produces: entry-point registration gate that returns before `registerWorkspaceNamer`.

- [ ] **Step 1: Write the failing regression test**

Add a test that stubs `HERDR_ENV=1` and `PI_SUBAGENT_CHILD=1`, invokes `workspaceNamer(pi)`, and asserts `on`, `setSessionName`, and `exec` were never called.

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/extension.test.ts`
Expected: the new test fails because lifecycle handlers are currently registered.

- [ ] **Step 3: Implement the minimal gate**

Change the entry point to:

```ts
if (process.env.HERDR_ENV !== "1" || process.env.PI_SUBAGENT_CHILD === "1") return;
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/extension.test.ts`
Expected: all extension tests pass.

- [ ] **Step 5: Prepare patch metadata**

Set package and lockfile version to `0.1.1`. Add a dated `0.1.1` changelog entry stating that Pi subagent child sessions no longer rename Herdr workspaces.

- [ ] **Step 6: Run complete verification**

Run: `npm run check && npm run verify:package && npm pack --dry-run`
Expected: all tests, typechecking, formatting, verifier, and package dry run pass.

- [ ] **Step 7: Commit and open PR**

```bash
git add extensions/workspace-namer.ts test/extension.test.ts CHANGELOG.md package.json package-lock.json docs/superpowers

git commit -m "fix: ignore Pi subagent child sessions"
git push -u origin fix/ignore-pi-subagents
gh pr create --base main --head fix/ignore-pi-subagents --title "fix: ignore Pi subagent child sessions" --body-file <prepared-body>
```

- [ ] **Step 8: Merge and publish**

After required `test (22)` and `test (24)` checks pass, squash-merge the PR, tag the merged commit `v0.1.1`, publish npm `0.1.1`, and verify the registry.

- [ ] **Step 9: Update local installation**

Run: `pi update npm:pi-herdr-workspace-namer`
Expected: installed package manifest reports `pi-herdr-workspace-namer@0.1.1`.
