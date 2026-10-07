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

### Shared Storage Path And File Name Rule

The canonical image settings are `images.storagePath`,
`images.fileNameRule`, and the exact `images.uploadFormats` map. Their defaults
are `{year}/{month}`, `{md5}`, and all six ordered entries enabled:
`webp`, `png`, `jpg`, `jpeg`, `jfif`, `gif`. `storagePath` may be empty, which
means the provider bucket or WordPress upload root; an absent field is a legacy
shape and is not equivalent to an explicitly empty path. `fileNameRule` is a
suffix-free basename stem and never contains `{ext}`. Canonical payloads must
contain exactly those six boolean extension keys, with at least one enabled;
`jpg`, `jpeg`, and `jfif` are independent selections even though the latter
two use the JPEG MIME family.

The Settings Center preview expands the path and stem and appends the first
enabled entry from that fixed registry. With the defaults its example is
`2026/07/a8f4c2d1.webp`. Preview ordering is presentation-only: each local or
hosted upload preserves its lowercased, verified source extension, and that
extension must match the real MIME family and its own enabled checkbox. No
JPEG sibling checkbox authorizes or renames another sibling. An extensionless
remote image receives the documented MIME-derived compatible suffix; a supplied
but mismatched or disabled suffix fails explicitly.

When a stored settings document has no `storagePath`, the settings owner first
splits the old complete `fileNameRule` at its last `/`. It then removes exactly
one terminal `.{ext}` from the basename. Only that terminal placement is
representable. `{ext}` in a directory, in the middle, repeated, or leaving an
empty stem is an explicit configuration/import error; the settings owner never
silently drops or relocates it. This is a read-time projection only: it must not
write or increment the settings revision. The next legitimate Settings Save
persists both canonical fields. A legacy write payload from an already-open page
may omit `storagePath` and receives the same deterministic conversion. Legacy
four-key `uploadFormats` maps expand `jpg` to `jpg`, `jpeg`, and `jfif`, while
PNG, WebP, and GIF retain their values. Settings Center bootstrap schema 4 and
Transfer schema 12 are canonical; schemas 1 through 11 receive the explicit
legacy conversion, while schema 12 is strict.

`ObjectKeyBuilder` is the single owner that combines, validates, and expands the
path and suffix-free stem exactly once for provider uploads and EasyMDE
local paste/drop uploads sent to `/easymde/v1/media`. It appends exactly one
verified source extension after MIME and checkbox validation; no canonical rule
or preset can use `{ext}`. Combined validation preserves the historical
160-byte limit, traversal/character rules, and final object-key checks. UTC,
UUID, `post_id`, digest, date/time, and sanitized-name variables are expanded
only by this builder. Any path, stem, extension, MIME, or rule failure is
explicit; neither owner falls back to another key builder or an ordinary upload
path.

The Media controller takes one credential-free settings snapshot, validates the
real MIME, exact source extension, enabled format, and size, then reads bounded
exact bytes before calling the shared builder. Its `MediaUploadPathScope`
matches the exact temporary file plus a one-time internal token. Its
final-priority sideload prefilter restores the generated basename; the matching
final overrides hook only registers an exact-file final
`wp_check_filetype_and_ext` callback. That final MIME callback arms the one-shot
`upload_dir` projection, so upload-directory reads from earlier overrides or
MIME callbacks remain ordinary. For the owned upload operation only, a scoped
`jfif => image/jpeg` allowance lets WordPress Core persist a JFIF upload; it is
removed in `finally` and never changes the global MIME policy. Every operation
removes the prefilter, overrides, MIME, and upload-directory hooks in `finally`.
WordPress Core remains authoritative for MIME handling, `wp_unique_filename()`,
attachment creation, metadata, sub-sizes, URLs, permissions, and the native
media picker. Original sanitized client names supply the response filename,
alt text, title response, and attachment title stem; generated hash/UUID values
must not leak into those human fields.

Changing either canonical field invalidates the Settings Center's prior
verification result and its stale-result fingerprint. Provider verification and
future Media uploads therefore observe one current pair of fields.

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
