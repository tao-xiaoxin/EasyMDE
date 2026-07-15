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

## Before Upgrading

- Confirm the release ZIP includes Composer runtime dependencies and local runtime assets.
- Back up database content before editing representative EasyMDE posts after the upgrade.
- Keep a copy of any custom publishing or export workflow that depends on EasyMDE-rendered HTML.

## After Upgrading

Verify representative content before broad author use:

- Open an existing EasyMDE post and confirm the Markdown source loads.
- Save the post and confirm rendered `post_content` matches the Markdown preview.
- Restore a recent revision and confirm Markdown, article theme, code theme, fixed code frame, custom CSS snapshot, font settings, and rendered HTML return to the same version.
- Check posts using custom CSS snapshots after editing or deleting saved custom CSS library entries.
- Confirm extensions using `EasyMDE_Plugin::register_toolbar_button()` or `EasyMDE_Plugin::register_shortcode_helper()` still appear in the editor configuration.
- Create a new post and a new page through the default WordPress flow, and confirm EasyMDE opens for both.
- Open an existing ordinary supported post without EasyMDE metadata and confirm EasyMDE imports current content into Markdown without changing post content, metadata, or revisions before save.
- Save that ordinary post from EasyMDE and confirm `_easymde_enabled`, `_easymde_markdown`, and rendered `post_content` are consistent.

## Downgrades And Rollbacks

If you roll back EasyMDE, keep the database backup until you have verified edited posts. Older releases may not understand newer render settings, theme choices, custom CSS snapshots, or font metadata even though `_easymde_markdown` remains stored.

When rolling back after a failed upgrade, prefer restoring both files and database from the same backup point. Restoring only plugin files can leave newer metadata paired with older rendering behavior.

## Related Docs

- [User Guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing and Release](docs/TESTING_AND_RELEASE.md)
