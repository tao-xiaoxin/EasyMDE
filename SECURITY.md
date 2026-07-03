# Security Policy

## Reporting a Vulnerability

Use a GitHub Private Security Advisory for suspected EasyMDE vulnerabilities whenever possible.

Please do not disclose unpatched vulnerabilities in public issues, discussions, pull requests, or social posts. Do not upload production tokens, cookies, site backups, real user data, private post content, database dumps, or detailed exploit payloads to public channels.

If a private advisory is not available to you, open a minimal public issue that asks for a private contact path without including exploit details or sensitive data.

## Supported Versions

Security fixes target the current maintained release line. Early pre-1.0 releases may receive focused security fixes for the latest tagged version when a safe patch is practical.

Sites should update to the latest EasyMDE release before reporting a vulnerability unless the issue is specifically about the upgrade path.

## Handling Process

Maintainers will review reports, reproduce the issue where possible, assess affected versions, and prepare a focused fix. The fix should preserve EasyMDE's existing WordPress permission checks, nonce checks, Markdown sanitization, custom CSS policy, revision behavior, and local-asset guarantees.

Coordinated disclosure timing depends on severity, exploitability, and maintainer availability. The project will avoid promises about exact response or release times that cannot be guaranteed.
