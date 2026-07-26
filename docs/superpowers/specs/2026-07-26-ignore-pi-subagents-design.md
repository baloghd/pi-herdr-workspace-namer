# Ignore Pi Subagents Design

## Problem

`pi-subagents` child processes inherit `HERDR_ENV=1`. The workspace namer therefore loads in each child, sees native child session names such as `subagent-worker` or `subagent-reviewer`, and mirrors them onto the shared Herdr workspace.

## Design

Treat `PI_SUBAGENT_CHILD=1` as an extension-level exclusion. The extension entry point will return before registering any lifecycle handlers when either:

- `HERDR_ENV` is not exactly `1`; or
- `PI_SUBAGENT_CHILD` is exactly `1`.

This uses the explicit child-process contract emitted by `pi-subagents`, rather than brittle title-prefix filtering. Parent Pi sessions remain unchanged. Child processes make no model calls, register no handlers, and execute no Herdr commands.

## Testing

Add an extension registration test with both `HERDR_ENV=1` and `PI_SUBAGENT_CHILD=1`, asserting no handlers, session mutations, or commands. Preserve the existing positive Herdr registration test and full suite.

## Release

Release as patch version `0.1.1` through a pull request against protected `main`. Update changelog and package version, publish after CI passes, then replace the local npm installation with `0.1.1` and verify the installed manifest.
