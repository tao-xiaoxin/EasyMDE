# Security Policy

## Reporting A Vulnerability

Use a GitHub Private Security Advisory for suspected EasyMDE vulnerabilities whenever possible.

Please do not disclose unpatched vulnerabilities in public issues, discussions, pull requests, or social posts. Do not upload production tokens, cookies, site backups, real user data, private post content, database dumps, REST nonces, administrator credentials, or detailed exploit payloads to public channels.

If a private advisory is not available to you, open a minimal public issue that asks for a private contact path without including exploit details or sensitive data.

## Supported Versions

Security fixes target the current maintained release line. Early pre-1.0 releases may receive focused security fixes for the latest tagged version when a safe patch is practical.

Sites should update to the latest EasyMDE release before reporting a vulnerability unless the issue is specifically about the upgrade path.

## Security Boundaries

EasyMDE security work should preserve the current boundaries:

- EasyMDE is opt-in per post/page and must not take over unrelated admin pages.
- State-changing admin saves require the EasyMDE nonce and `current_user_can( 'edit_post', $post_id )`.
- REST requests with `post_id` require edit access to that post.
- Custom CSS write/delete operations require `unfiltered_html` and access only the current user's library.
- Markdown is treated as untrusted input, raw Markdown HTML is stripped, and rendered HTML is sanitized before output.
- Editor, preview, Mermaid, KaTeX, Highlight.js, and theme assets are local runtime assets rather than CDN requirements.

## Handling Process

Maintainers will review reports, reproduce the issue where possible, assess affected versions, and prepare a focused fix. Coordinated disclosure timing depends on severity, exploitability, and maintainer availability. The project avoids promises about exact response or release times that cannot be guaranteed.
