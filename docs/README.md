# EasyMDE Documentation

This index points to the current technical docs. The root [Simplified Chinese README](../README.md) and [English README](../README.en.md) are GitHub entry points; this directory is the canonical technical documentation for now.

## Reading Paths

**Users**

1. [Simplified Chinese README](../README.md) and [English README](../README.en.md) for product scope, requirements, and installation.
2. [User Guide](USER_GUIDE.md) for editor behavior, themes, local drafts, rendering extras, and Copy to WeChat.
3. [Upgrading EasyMDE](../UPGRADING.md) before updating a site with existing Markdown posts.
4. [Security Policy](../SECURITY.md) for vulnerability reporting.

**Local Contributors**

1. [Contributing](../CONTRIBUTING.md) for project rules and PR expectations.
2. [Local Codex Review Template](templates/LOCAL_CODEX_REVIEW.md) for the reusable local review body.
3. [CodeRabbit Review Templates](templates/CODERABBIT_REVIEW.md) for first-review and re-review bodies.
4. [Issue Body Template](templates/ISSUE.md) for new public Issue bodies.
5. [Pull Request Body Template](templates/PULL_REQUEST.md) for pull request bodies.
6. [Agent Instructions](../AGENTS.md) for binding repository-wide invariants.
7. [Core Philosophy](CORE-PHILOSOPHY.md) for a non-normative mnemonic introduction.
8. [Architecture](ARCHITECTURE.md) for the current implementation boundaries.
9. [React Design Philosophy](REACT_DESIGN_PHILOSOPHY.md) for approved React target architecture and interface-design decisions.
10. [ADR-001: Portable WeChat Clipboard Serialization](decisions/ADR-001-wechat-clipboard-serialization.md) for the copy boundary and rejected alternatives.
11. [Development](DEVELOPMENT.md) for Composer, npm assets, Docker, `.env`, and WordPress test-suite setup.
12. [Testing and Release](TESTING_AND_RELEASE.md) for quality gates that apply when code, assets, release scripts, or packaging behavior change.

**Maintainers Preparing Releases**

1. [Testing and Release](TESTING_AND_RELEASE.md) for the release ZIP build, clean install, Plugin Check, and Chromium E2E flow.
2. [Plugin Check Notes](PLUGIN_CHECK.md) for accepted warnings and release-policy rationale.
3. [Upgrading EasyMDE](../UPGRADING.md) for user-facing upgrade and rollback guidance.
4. [Third-party Notices](../THIRD-PARTY-NOTICES.md) for bundled runtime dependency notices.

**Extension Developers**

1. [Architecture](ARCHITECTURE.md) for directories, data model, REST boundaries, theme registries, and compatibility facade behavior.
2. [User Guide](USER_GUIDE.md) for the author-facing workflows extensions should preserve.
3. [Contributing](../CONTRIBUTING.md) before proposing new extension points or compatibility changes.

## Source-Of-Truth Files

- [WordPress package readme](../readme.txt)
- [Architecture](ARCHITECTURE.md)
- [React Design Philosophy](REACT_DESIGN_PHILOSOPHY.md)
- [Plugin Check Notes](PLUGIN_CHECK.md)
- [ADR-001: Portable WeChat Clipboard Serialization](decisions/ADR-001-wechat-clipboard-serialization.md)
- [Security Policy](../SECURITY.md)
- [Upgrade Notes](../UPGRADING.md)
- [Agent Instructions](../AGENTS.md)
