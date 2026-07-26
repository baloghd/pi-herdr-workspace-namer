# Pi Herdr Workspace Namer

Turn the first task in a Pi coding session into a short, useful Herdr workspace label—without changing the way you work.

```text
You: Add retry handling to the payment webhook
Pi session: Payment Webhook Retries
Herdr: Payment Webhook Retries
```

## Requirements

- [Pi](https://github.com/badlogic/pi-mono) `>=0.82.1`
- Herdr `>=0.7.5` when running inside Herdr
- Node.js `>=22`

## Install, update, and uninstall

```bash
pi install npm:pi-herdr-workspace-namer
pi update pi-herdr-workspace-namer
pi remove npm:pi-herdr-workspace-namer
```

The extension is loaded by Pi from the package's extension manifest. It does not need a separate daemon.

## Behavior

| Event | What happens |
| --- | --- |
| Startup | The current Pi session name is treated as authoritative and synchronized to the current Herdr workspace when available. |
| `/new` | Starts a new Pi session. Its first ordinary prompt becomes the naming candidate. |
| `/resume` | Reconstructs only records belonging to the resumed Pi session; an existing session name is reused. |
| `/fork` | Starts a new Pi session identity. The fork must receive its own first prompt before it is named. |
| `/name` | A manually assigned Pi session name is synchronized to the current Herdr workspace. |
| Later prompts | Do not trigger another generated name in the same Pi session. |
| Outside Herdr | Pi still receives its generated session name, but no Herdr command is attempted. |

Generated naming is enabled by default and runs after the agent settles the first prompt. A manually supplied Pi session name always takes precedence.

## Configuration

Settings may be placed in `~/.pi/agent/settings.json`. A project-level `.pi/settings.json` overrides individual user settings. Both use this shape:

```json
{
  "herdrWorkspaceNamer": {
    "enabled": true,
    "maxLength": 48,
    "fallback": "local",
    "notifyOnError": true,
    "herdrCommand": "herdr",
    "commandTimeoutMs": 5000
  }
}
```

Defaults are enabled naming, a 48-character maximum, deterministic `local` fallback, warning notifications enabled, the `herdr` command, and a 5-second command timeout. `maxLength` accepts 16–80; `commandTimeoutMs` accepts 500–30000 milliseconds. The fallback is currently fixed to `local`.

## Privacy and cost

For an eligible first prompt, the prompt is sent to the active provider in **one additional model request** to produce the title. If that request is unavailable or its result is unusable, a deterministic local fallback is used. This package sends no telemetry and stores only bounded, session-scoped lifecycle records in the Pi session.

## Herdr limitation

`workspace rename` creates a custom workspace name. Current Herdr cannot reset a custom name to its generated default, so use `/name` deliberately. The active Pi session name is authoritative: changing it overwrites the Herdr workspace label for the current pane.

## Security warning

Pi packages execute with **full user privileges**. Review this package's source and the commands it runs before installing it. Herdr is invoked through Pi's argument-array execution API; the extension does not run a shell command string.

## Troubleshooting

Check that Pi is running in Herdr and inspect the current placement:

```bash
herdr integration status
herdr pane current --current
pi list
```

After changing package or settings files, reload the extension with `/reload`, then start a new session or send its first ordinary prompt. If a workspace still has an unexpected label, inspect the Pi session name first; that is the source of truth.

## Development

```bash
npm ci
npm run check
npm test -- test/docs.test.ts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the RED/GREEN workflow and compatibility evidence.

## Release

Before a release, run `npm run check`, `npm run verify:package`, and `npm pack --dry-run`. The package verifier performs its internal dry run with lifecycle scripts disabled, checks the publish allowlist and required runtime resources, and scans likely secret assignments without treating documentation placeholders such as `API_KEY=` as secrets.

An optional live smoke uses only the disposable named Herdr session `pi-herdr-workspace-namer-smoke`:

```bash
PI_HERDR_WORKSPACE_NAMER_LIVE=1 npm run test:live
```

It refuses to reuse an existing session with that name. If installed Herdr lacks safe isolated noninteractive syntax, the smoke reports a clear skip instead of targeting the active/default session. See [CHANGELOG.md](CHANGELOG.md) for release history.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); do not put secrets or exploit details in a public issue.

## License

[MIT](LICENSE)
