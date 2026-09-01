---
name: easymde
description: Use when building, changing, debugging, reviewing, or validating EasyMDE React, TypeScript, browser, editor, preview, theme, media, accessibility, or WordPress admin integration, including browser-owner transfer, deprecation, and removal. Do not use for PHP-only, i18n/translation-only, release-only, or documentation-only work unless the task also changes a browser contract.
---

# EasyMDE Browser Skill

This is the executable contract for EasyMDE browser work, a standalone
WordPress Markdown editor. Read the matching reference completely before
implementing its behavior; do not load unrelated profiles.

## Route and authority

Use this Skill for focused React/TypeScript features and for changes that move,
deprecate, or remove a browser owner. The live repository and `AGENTS.md` are
above this Skill; current implementation facts belong to `docs/ARCHITECTURE.md`,
durable design rationale to `docs/DESIGN.md`. When a task
touches user-visible strings, load the repository-local `easymde-i18n` Skill at
`.agents/skills/i18n/SKILL.md`. Release facts belong to
`docs/TESTING_AND_RELEASE.md`.
Focused maintainer decisions and Issue scope apply within those boundaries.

## Image Hosting Owner Contract

The approved Image Hosting service is an explicit upload-owner choice, not a
fallback path. The persisted `imageHostingEnabled` value is a strict boolean
and defaults to `false`:

- `false`: eligible local image paste and drop use the existing protected
  WordPress Media Library `/media` owner, and remote image import is off;
- `true`: eligible local image paste and drop use the protected Image Hosting
  owner, with remote import governed by its configured mode; and
- a selected owner failure remains explicit and never switches to the other
  owner.

When Image Hosting is disabled, article `/image-hosting/upload` and
`/image-hosting/import` reject with HTTP 409 before provider access. Image
Hosting settings, Verify Upload, and the explicit secret-reveal action remain
available under their own administrator, Nonce, and transient-memory
contracts.

### Shared File Name Rule

The saved `fileNameRule` remains configurable and visible while Image Hosting
is disabled. `ObjectKeyBuilder` is the single expansion owner for provider
uploads and future EasyMDE local paste/drop uploads sent to `/easymde/v1/media`.
The Media controller takes one credential-free settings snapshot, validates the
real MIME and size, then reads bounded exact bytes before expanding UTC, UUID,
`post_id`, digest, date/time, name, and verified-extension variables. Its
`MediaUploadPathScope` matches the exact temporary file plus a one-time internal
token. Its final-priority sideload prefilter restores the generated basename;
the matching final overrides hook only registers an exact-file final
`wp_check_filetype_and_ext` callback. That final MIME callback arms the one-shot
`upload_dir` projection, so upload-directory reads from earlier overrides or
MIME callbacks remain ordinary. Every operation removes the prefilter,
overrides, MIME, and upload-directory hooks in `finally`.
WordPress Core remains authoritative for MIME handling, `wp_unique_filename()`,
attachment creation, metadata, sub-sizes, URLs, permissions, and the native
media picker. Original sanitized client names supply the response filename,
alt text, title response, and attachment title stem; generated hash/UUID values
must not leak into those human fields. A scope or rule failure is explicit and
must never fall back to an ordinary upload path.

This behavior covers future EasyMDE paste/drop uploads only. It does not move
historical attachments or change the explicit native media-picker insertion
entry point. Current ownership and implementation facts are routed to
[`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md), while the executable PHP
and installed-ZIP browser checks are routed to
[`docs/TESTING_AND_RELEASE.md`](../../../docs/TESTING_AND_RELEASE.md).

Choose references by task:

- [current editor contract](references/current-editor-contract.md) for roots,
  owners, data, compatibility, and browser boundaries.
- [React architecture](references/react-architecture.md) for composition,
  Ports, state, lifecycle, naming, and packages.
- [browser ownership and removal](references/browser-ownership-and-removal.md)
  for characterization, shims, consumer inventories, and deletion evidence.
- [security and native operations](references/security-and-native-operations.md)
  for authorization, REST, HTML, CSS, mutations, and privacy.
- [Preview and Feature contracts](references/preview-and-feature-contracts.md)
  for Preview, enhancement, form, storage, and async behavior.
- [WeChat export](references/wechat-export.md) for the Clipboard serializer and
  its ordinary/immersive surface contract.
- [UI fidelity and accessibility](references/ui-fidelity-and-accessibility.md)
  for controlled visual, responsive, keyboard, and accessibility evidence.
- [dependencies, assets, and services](references/dependencies-assets-and-services.md)
  for packages, local assets, themes, fonts, and services.
- [testing and delivery](references/testing-and-delivery.md) for focused
  checks, evidence, package impact, and completion reporting.

## Required execution

1. Inspect live owners, package scripts, contracts, and affected tests.
2. State goal, current/intended owner, authority, failure, stale-result,
   teardown, package impact, and unverified areas before choosing an abstraction.
3. Implement one owner with typed boundaries. Preserve WordPress authority,
   the open native form, public extension contracts, local runtime assets, and
   privacy-safe diagnostics. Never add hidden writes, fake success, silent
   fallback, or a second document/render/save authority.
4. Run scope-relevant tests and evidence checks. Fix root causes, re-run after
   the final change, and report failures and unavailable evidence honestly.

Normal Feature work uses scope-relevant checks. Full browser-owner inventory,
characterization, zero-consumer proof, and removal evidence are mandatory for
owner transfer, compatibility shim, deprecation, or deletion work only.

## Completion gate

Before completion, confirm one owner per behavior, pure render/Hooks, runtime
validation, dependency direction, real operation results, accessibility,
stale-work protection, cleanup, package impact, and an exact evidence report.
Builds, screenshots, and static presence do not prove runtime ownership. Use
`unverified` or `blocked` when evidence is unavailable.
