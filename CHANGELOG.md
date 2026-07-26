# Changelog

All notable changes to this project are documented here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-07-26

### Fixed

- Prevent Pi subagent child sessions from renaming Herdr workspaces.

## [0.1.0] - 2026-07-26

### Added

- Generate a concise workspace title from the first eligible Pi prompt.
- Use the active Pi model for one additional title request, with a deterministic local fallback.
- Synchronize the authoritative Pi session name to the current Herdr workspace.
- Reconstruct session-scoped state safely across resume and fork lifecycle events.
- Provide bounded command execution, placement re-checks, verification, and failure isolation.

### Compatibility

- Pi `>=0.82.1`
- Herdr `>=0.7.5`
- Node.js `>=22`

[0.1.1]: https://github.com/tfolkman/pi-herdr-workspace-namer/releases/tag/v0.1.1
[0.1.0]: https://github.com/tfolkman/pi-herdr-workspace-namer/releases/tag/v0.1.0
