# Pull Request Body Template

Use this reusable body with the [Issue and Pull Request Workflow](../../CONTRIBUTING.md#issue-and-pull-request-workflow).

```markdown
Closes #123

<!-- Use `Related to #123` instead when this PR does not fully resolve the Issue. -->

## Summary

- Describe the concrete changes.
- Explain the user, compatibility, security, maintenance, or release problem they solve.

## Scope and linked Issue

- Linked Issue: #123
- Confirm that this PR stays within the Issue scope.
- List intentionally deferred or excluded work.

## Human closure control

This pull request and its linked Issues must remain open until a human maintainer explicitly authorizes merge or closure. Green CI, bot approval, resolved threads, completed checklists, or inactivity are not closure authorization.

## Implementation notes

Describe important state transitions, WordPress integration points, compatibility boundaries, and failure behavior.
Do not include private implementation evidence or local environment details.

## Safety and compatibility

- Markdown source-of-truth impact:
- `post_content` compatibility impact:
- WordPress permissions, nonce, REST, save, revision, or publishing impact:
- Existing settings, themes, extension APIs, and migration impact:
- Runtime dependencies, assets, licenses, and release-package impact:

## Validation

List only checks actually performed, including commands and results where useful.
State unavailable or unverified checks honestly.

- [ ] Focused automated tests
- [ ] Relevant integration or browser checks
- [ ] PHP, Node, lint, i18n, build, or package checks as applicable
- [ ] Negative, cancellation, permission, and failure-path checks as applicable
- [ ] For agent-authored or automated work, local `codex-review` covered the exact outgoing state before push
- [ ] For agent-authored or automated work, the current pushed Head matches the reviewed commit set, or local review was rerun after the state changed
- [ ] Every confirmed local review finding was resolved and affected validation was rerun, when local review was used
- [ ] Final local review verdict recorded without private local details, when local review was used
- [ ] CI status reviewed for the current head SHA
- [ ] Existing CodeRabbit request status checked before posting a new review command

## Privacy and public artifact review

- [ ] Reviewed the diff, commit messages, PR body, linked Issue, review replies, fixtures, and generated artifacts for private information.
- [ ] No secrets, credentials, cookies, private keys, personal data, private article content, local configuration, or unredacted sensitive values are included.
- [ ] No unnecessary absolute paths, usernames, home directories, localhost/private/staging endpoints, ports, logs, HAR files, browser storage, screenshot paths, or machine identifiers are included.
- [ ] No user-provided reference screenshot or file was committed or publicly reposted without necessity, authorization, and content/metadata inspection.
- [ ] New images, archives, fonts, SVGs, binaries, and embedded data were checked for unnecessary EXIF, XMP, IPTC, geolocation, creator-tool, document-ID, instance-ID, and similar metadata.
- [ ] Sensitive values in public descriptions are redacted rather than repeated.

## Remaining risks and follow-up

List known limitations, assumptions, deferred work, unresolved local or remote review findings, bot availability or waiting state, or checks that could not be run.
```
