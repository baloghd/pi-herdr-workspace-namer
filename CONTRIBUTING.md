# Contributing

Thanks for helping improve Pi Herdr Workspace Namer.

## Setup

Use Node.js `>=22`, then install the locked dependencies:

```bash
npm ci
```

## Test-driven workflow

1. Add a focused test that describes the intended behavior.
2. Run it and capture the expected **RED** failure (`npm test -- path/to/test.ts`).
3. Implement the smallest change that makes it **GREEN**.
4. Run `npm run check` before opening a pull request.

Do not include provider credentials, prompts, workspace contents, or unbounded command output in tests or reports. Optional live validation may be run with `npm run test:live` when a disposable Herdr environment is available; explain when it is not run.

## Pull requests and issues

For an issue, include Pi, Herdr, Node, and package versions, reproduction steps, expected and actual behavior, and a sanitized command/test result. For a pull request, include:

- a concise description and scope;
- tests added or updated, including RED/GREEN evidence;
- `npm run check` output;
- compatibility impact and any optional live-smoke result;
- security or privacy considerations.

Keep changes focused. Preserve the lifecycle, source-of-truth, subprocess, privacy, and failure-isolation invariants in [AGENTS.md](AGENTS.md).

## Compatibility report template

```md
Pi: <version>
Herdr: <version or not tested>
Node: <version>
Checks: <commands and result>
Live smoke: <passed, failed, or not run; why>
Compatibility notes: <details>
``` 
