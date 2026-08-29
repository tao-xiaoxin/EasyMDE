# Current Editor Contract

## Contents

- [Product and roots](#product-and-roots)
- [Authority and compatibility](#authority-and-compatibility)
- [Current browser surfaces](#current-browser-surfaces)
- [Themes and public boundaries](#themes-and-public-boundaries)

## Product and roots

EasyMDE is a standalone WordPress Markdown editor. The ordinary WordPress
editor uses one Vite production entry and one React 18 `EditorRoot`. The Root
owns editor presentation, CodeMirror document/title sessions, Preview, local
post-response enhancements, Appearance, Fonts, Custom CSS, Media, Local Drafts,
WeChat export, the fixed Source/Preview workspace, and browser-session state.
The dedicated Settings Center is a separate React root and must not share
mutable state with the Editor Root.

Immersive writing is an optional presentation in the same Editor Root, not the
ordinary editor's default surface. It reuses the document, Preview, native
form, and WordPress capability owners. It must not create a second document,
renderer, persistence path, or editor root. The ordinary workspace keeps its
restrained Markdown character count and WordPress-provided last-editor value;
it does not grow duplicate Publish, Revision, History, or statistics owners.

The production editor entry mounts one empty editor container and keeps the
WordPress form open to native and extension fields. CodeMirror owns in-page
Markdown, selection, focus, undo history, and source scrolling. Native title
and hidden Markdown fields are synchronous submission bridges, not persistence
proof. Teardown restores bridge visibility and removes listeners, observers,
timers, global styles, and browser locks.

## Authority and compatibility

- `_easymde_markdown` is the canonical Markdown source.
- `post_content` is safely rendered HTML for WordPress compatibility.
- WordPress/PHP owns admission, capabilities, Nonces, metadata, revisions,
  media, taxonomies, settings, locks, autosave, scheduling, Save, Publish,
  Post Status, public output, and the REST namespace `easymde/v1`.
- A supported Post enters EasyMDE through the shared post-admission rule, not
  because EasyMDE metadata exists. Opening an existing Post is zero-write;
  legacy HTML is imported in memory by the PHP migration owner and persisted
  only by a legitimate Save.
- An absent Markdown metadata record differs from an empty value; preserve the
  PHP `metadata_exists()` decision in browser schemas.
- `_easymde_render_signature` only validates reusable compatibility HTML; it
  never replaces Markdown as authority.
- `_easymde_code_mac_style` and `codeMacStyle` are inactive historical data.
  Preserve them without reading, writing, migrating, normalizing, revisioning,
  restoring, or exposing them as active state.
- Native and extension-owned fields remain intact. React may synchronize an
  explicitly delegated bridge, but it must not narrow the form to a closed
  allowlist or create a second save/publish/revision/media/settings authority.

The current formal Markdown renderer is PHP
`EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`. Raw Markdown
HTML remains disabled by default; final HTML is sanitized before entering the
single Preview-owned Safe HTML sink. If the renderer or Composer dependency is
unavailable, expose the real failure and do not generate fallback content.

## Current browser surfaces

The live build has dedicated, manifest-backed entries for the Editor, Settings
Center, public code-copy, shared public enhancements, Mermaid, DOM bootstrap,
and Media picker. Inspect the live manifests and `package.json` before making
claims about handles, dependencies, source paths, or output. The production
Editor uses the stable `easymde-admin-editor-toolbar` handle; Settings Center
uses `easymde-admin-settings-center`. Public enhancement entries do not load
the admin React application.

The Editor Root uses typed Ports and focused WordPress/browser Adapters. It
must preserve selection direction, IME composition, undo grouping, source and
Preview scrolling, editor instance identity, pending/error/conflict states,
and repeatable mount/unmount. Read-only shadow comparison may compare outputs,
but never mutates or becomes a second owner.

Current implementation details, exact source file lists, manifests, version
pins, and generated output belong to `docs/ARCHITECTURE.md` and the live code.
Do not infer current behavior from a planned path or an old Issue.

## Themes and public boundaries

`ArticleThemeRegistry` and `CodeThemeRegistry` explicitly register themes;
runtime directory scans are prohibited. Article CSS, code token CSS, and the
shared Mac code frame have separate owners. The per-article `defaultCodeTheme`
association is used only when no valid explicit selection exists; compatibility
fallbacks never write on open. Public assets load conditionally for the current
content and remain local.

Preserve public extension entry points and filters unless a focused compatibility
and deprecation plan authorizes change:

```text
EasyMDE_Plugin::register_toolbar_button()
EasyMDE_Plugin::register_shortcode_helper()
easymde_supported_post_types
easymde_article_themes
easymde_code_themes
easymde_revision_restore_failed
easymde/v1
```

Do not expose private Components, Stores, Adapters, or DOM details through an
extension descriptor. Preserve IDs, ordering, collision rules, handles, and
failure behavior relied on by consumers.
