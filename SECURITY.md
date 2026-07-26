# Security Policy

## Trust model

Pi packages execute with full system access and user privileges. This extension can invoke the configured Herdr command through Pi, and the package's source should be reviewed before installation. Keep Pi, Herdr, Node.js, and this package up to date.

Never paste API keys, credentials, private prompts, workspace data, or sensitive logs into a public issue.

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |
| `<0.1.0` | No released versions |

Support follows the latest release line unless a security advisory says otherwise.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/tfolkman/pi-herdr-workspace-namer/security/advisories/new). Include a minimal reproduction, affected version, impact, and a safe way to contact you. Do not open a public issue for an undisclosed vulnerability.

We target acknowledgement within a reasonable business window, coordinated remediation, and public disclosure after fixes are available. Our target for coordinated disclosure is 90 days from the initial report, adjusted when reporter and maintainer agree that users need more time.
