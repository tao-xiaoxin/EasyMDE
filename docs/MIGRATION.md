# EasyMDE Migration Notes

## Per-Post Enablement

EasyMDE no longer disables Gutenberg for all `post` and `page` screens.

Existing EasyMDE posts remain compatible:

- `_easymde_enabled = 1` explicitly enables EasyMDE.
- If `_easymde_enabled` is missing but `_easymde_markdown` exists, the post is treated as a legacy EasyMDE post.
- The legacy check uses `metadata_exists()` so an empty Markdown value still counts.

Legacy posts are migrated lazily. On the next valid EasyMDE save, the plugin
writes `_easymde_enabled = 1`. It does not scan or update every post during
upgrade.

## Markdown And HTML

`_easymde_markdown` remains the authoritative source. `post_content` remains the
rendered HTML compatibility output.

The fallback Markdown renderer has been removed. `league/commonmark` is required
for rendering. A development checkout without Composer dependencies shows an
admin notice and avoids writing newly rendered HTML.

Production release packages must include Composer dependencies in `vendor/`.

## Revision Behavior

The following meta keys are copied to new revisions and restored from revisions:

```text
_easymde_enabled
_easymde_markdown
_easymde_markdown_theme
_easymde_code_theme
_easymde_code_mac_style
_easymde_custom_css_id
_easymde_custom_css_snapshot
```

When a revision containing EasyMDE meta is restored, the restored Markdown and
theme state are copied back to the post. EasyMDE then regenerates `post_content`
from the restored Markdown using the restored article theme. The restore path
updates `post_content` directly and clears the post cache to avoid recursive save
hooks or extra revision loops.

Revisions created before this migration may not contain EasyMDE meta. Restoring
those revisions does not delete current EasyMDE meta automatically.

## Custom CSS

Existing custom CSS library data remains readable from the current user's
`easymde_custom_css_library` user meta.

New, updated, and deleted full custom CSS requires `unfiltered_html`. CSS is parsed with
`sabberworm/php-css-parser` before storage or scoping. Unsafe features such as
`@import`, `@charset`, `@font-face`, `url(...)`, `expression(...)`,
`behavior`, `-moz-binding`, and `javascript:` are rejected.

If legacy CSS cannot be parsed safely, the stored value is retained but scoped
frontend output is omitted.

## Theme Assets

Article themes moved from the previous all-in-one stylesheet into
`assets/themes/article/`. Highlight.js vendor styles moved to
`assets/vendor/highlight/styles/`. The owned `wechat-inspired` code theme moved
to `assets/themes/code/wechat-inspired.css`.

Old theme meta IDs are unchanged, so existing posts continue to resolve their
selected article theme, code theme, Mac code frame state, and custom CSS snapshot.
