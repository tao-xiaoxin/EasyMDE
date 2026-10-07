# Upgrading EasyMDE

Back up the WordPress database and `wp-content/` before upgrading EasyMDE, especially on sites with existing Markdown posts, custom CSS snapshots, or custom publishing workflows.

## Data Model

EasyMDE stores Markdown source in `_easymde_markdown`. That meta value is the source of truth for EasyMDE posts.

WordPress `post_content` stores rendered compatibility HTML for themes, feeds, search, plugins, visitors, and fallback behavior when EasyMDE is inactive.

Appearance and rendering state are stored in EasyMDE post meta, including article theme, code theme, custom CSS selection/snapshot, and font choices. The Mac-style source-code frame is fixed rendering behavior and is not stored as active state.

Newer releases may also store `_easymde_render_signature` as an internal
consistency marker for fast editor preview hydration. It is derived from the
Markdown source, article theme, and stored compatibility HTML; it does not
decide whether a post opens in EasyMDE.

## Editor Enablement

EasyMDE does not bulk-migrate every post during upgrades. New and existing posts for post types supported by `easymde_supported_post_types` open in EasyMDE through normal WordPress editing when the current user can create new posts or edit existing ones.

EasyMDE metadata now describes document state, not editor admission. Existing posts without `_easymde_enabled` but with `_easymde_markdown` are treated as legacy EasyMDE document-state posts by checking metadata existence. Empty Markdown still counts because detection uses `metadata_exists()`.

Opening an ordinary existing supported post imports current `post_content` into Markdown in memory for the editor. It does not write metadata, rewrite `post_content`, or create revisions. Legacy posts and ordinary supported posts are lazily marked with `_easymde_enabled = 1` only during the next legitimate EasyMDE save.

## Storage Path And File Name Rule

Image Hosting now exposes two settings: **Storage Path** and **File Name Rule**.
The canonical defaults are `{year}/{month}` and the suffix-free stem `{md5}`.
The first is a directory template; the second is a basename stem. An
explicitly empty Storage Path means the provider bucket or WordPress upload
root. The upload-format checkboxes are ordered **WebP, PNG, JPG, JPEG, JFIF,
GIF**; all six are enabled by default, and at least one must remain enabled.
JPG, JPEG, and JFIF are independent selections even though JFIF uses the
`image/jpeg` MIME family.

Existing settings may have only the old complete `fileNameRule`, or may have
the prior split Storage Path and a File Name Rule that still ends in
`.{ext}`. EasyMDE reads either shape without an option write, splits only the
single-field form at the last `/`, preserves an existing Storage Path, and
removes exactly one terminal `.{ext}` from the basename. A legacy rule with no
slash uses an empty Storage Path. `{ext}` in a directory, in the middle,
repeated, or leaving an empty stem is an explicit configuration/import error;
it is never silently dropped or relocated. Reads remain zero-write, and the
next legitimate Settings Save stores both fields. An already-open legacy page
may submit its old shape once and is normalized through the same deterministic
conversion. The old
four-key format map expands `jpg` into independent `jpg`, `jpeg`, and `jfif`
entries. Transfer schemas 1 through 11 receive this explicit conversion;
schema 12 is strict and exports the two canonical fields plus the exact
six-key format map. Settings Center bootstrap schema is 4.

`ObjectKeyBuilder` combines the path and suffix-free stem for both Image
Hosting and future EasyMDE local paste/drop uploads through
`/easymde/v1/media`. After real MIME, exact source-extension, and checkbox
validation, it appends exactly one lowercased verified extension. Canonical
rules do not accept `{ext}`. Changing either field or the format map makes the
prior Verify Upload result stale. Existing attachment files, provider objects,
and paths are not renamed or moved, and the explicit native WordPress media
picker is unchanged. A JFIF upload receives only the scoped `jfif =>
image/jpeg` allowance for that owned operation; the global WordPress MIME
policy is not changed.

After upgrading, confirm the default preview is
`2026/07/a8f4c2d1.webp`, test one synthetic EasyMDE paste/drop upload for each
JPEG alias you intend to allow, and run Verify Upload if the naming layout is
important to your workflow. Real uploads retain their source suffix; do not
expect historical attachments or provider objects to follow a new rule.

## Before Upgrading

- Confirm the release ZIP includes Composer runtime dependencies and local runtime assets.
- Back up database content before editing representative EasyMDE posts after the upgrade.
- Keep a copy of any custom publishing or export workflow that depends on EasyMDE-rendered HTML.

## After Upgrading

Verify representative content before broad author use:

- Open an existing EasyMDE post and confirm the Markdown source loads.
- Save the post and confirm rendered `post_content` matches the Markdown preview.
- Restore a recent revision and confirm Markdown, article theme, code theme, custom CSS snapshot, font settings, and rendered HTML return to the same version while the fixed code frame remains applied.
- Check posts using custom CSS snapshots after editing or deleting saved custom CSS library entries.
- Confirm extensions using `EasyMDE_Plugin::register_toolbar_button()` or `EasyMDE_Plugin::register_shortcode_helper()` still appear in the editor configuration.
- Create a new post and a new page through the default WordPress flow, and confirm EasyMDE opens for both.
- Open an existing ordinary supported post without EasyMDE metadata and confirm EasyMDE imports current content into Markdown without changing post content, metadata, or revisions before save.
- Save that ordinary post from EasyMDE and confirm `_easymde_enabled`, `_easymde_markdown`, and rendered `post_content` are consistent.

## Downgrades And Rollbacks

If you roll back EasyMDE, keep the database backup until you have verified edited posts. Older releases may not understand newer render settings, theme choices, custom CSS snapshots, or font metadata even though `_easymde_markdown` remains stored.

The suffix-free image rule, six-key format map, Settings Center bootstrap schema
4, and Transfer schema 12 are also newer data contracts. A pre-change release
may not understand them or may still expect `{ext}`; it must not be allowed to
silently rewrite them. When rolling back after a failed upgrade, restore both
plugin files and the database from the same backup point, or first restore the
pre-change settings option. Restoring only plugin files can leave newer image
metadata paired with older naming and MIME behavior. Existing uploaded objects
and attachments are not renamed by either upgrade or rollback.

## Related Docs

- [User Guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing and Release](docs/TESTING_AND_RELEASE.md)
