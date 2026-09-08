# EasyMDE Design

This document records the long-term design rationale and stable boundaries for EasyMDE's React, TypeScript, and Vite applications in WordPress administration.
It answers only why EasyMDE divides responsibilities this way and which boundaries short-term implementation must not replace; it does not define the current implementation inventory, browser execution contract, testing steps, or release checklist.

Authoritative routes:

- Current implemented PHP, React, entrypoint, Manifest, and service boundaries: [Architecture](ARCHITECTURE.md).
- The executable React and browser implementation contract, owner inventory, removal evidence, and package impact: `.agents/skills/easymde/SKILL.md` and its `references/` directory.
- Testing, CI, installable ZIP, source archive, and E2E steps: [Testing and Release](TESTING_AND_RELEASE.md).
- PHP and React string ownership, extraction, catalogs, locale, RTL, and language assets: `.agents/skills/i18n/SKILL.md`.
- WeChat decisions, alternatives, and consequences: [ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md).

When this document conflicts with code or current work, current human decisions, `AGENTS.md`, the live repository, and committed public compatibility contracts take precedence; do not mistake design rationale for implementation evidence.

## 1. Product Boundaries

EasyMDE is a WordPress Markdown editor, not a new CMS, permission system, rendering backend, or publishing platform.
React is responsible only for admin presentation, interaction orchestration, and browser state during the editing session.
PHP and WordPress continue to own:

- Admission for supported Post Types, capabilities, Nonces, authentication, locks, and the site timezone.
- Post Meta, Options, Autosave, Revisions, Media, Taxonomy, Status, Save, and Publish.
- Formal Markdown rendering, HTML sanitization, public content, feeds, search, and compatibility output.
- Article Theme, Code Theme, Custom CSS, and public extension Registries.

`_easymde_markdown` is the only Markdown source, `post_content` is safely rendered WordPress compatibility HTML, and `post_title` remains persisted by WordPress.
Opening an ordinary supported Post remains zero-write; when Markdown is absent, the existing PHP Migration owner imports HTML in memory, and the next legitimate save establishes new document state.
React does not create a second formal Renderer, Save, Publish, Revision, Media, Settings, Permission, Timezone, or Public Content authority.

The WordPress editing form is an open compatibility surface.
React synchronizes only explicitly delegated native fields; it must not rebuild submission with a closed TypeScript field list or discard Meta Box or extension fields.
Synchronizing to hidden fields is only a Submission Bridge, not a persistence success signal.

## 2. Ordinary Editor and Root

The ordinary WordPress Editor uses one React Editor Root that covers the editing, Preview, Appearance, Fonts, Custom CSS, Media, Local Draft, WeChat, and fixed Source/Preview workspace capabilities required by the historical editor.
The Root can compose multiple focused Features, but each external responsibility has one owner.

Focus Mode and immersive writing do not belong to the default ordinary-editor surface.
The immersive presentation stays within the same Root; it reuses the ordinary
editor's document, Preview, native form, media, revision, and WordPress session
owners, and it does not create a second Root, editor, Renderer, save path, or
persistence model. Publish, History, Outline, statistics, and view interactions
may only project existing WordPress capabilities; submission and restoration
return to their native owners.

The Settings Center is an independent React Root because it is an independent WordPress administration screen.
It does not share mutable Stores, Contexts, caches, or lifecycle owners with the Editor Root.
The ordinary editor and Settings Center must both use the React 18 runtime provided by WordPress, but this does not authorize another React runtime, an admin SPA, a Router, or a Hydration model.
The canonical Settings route also has an independent presentation document.
WordPress performs authentication, screen resolution, and capability admission,
then the page load hook emits the Settings document before the ordinary admin
header can become a competing paint owner. This boundary is necessary for a
stable first frame: a body veil, duplicated PHP application shell, broad
wp-admin hiding, delayed mount, or larger z-index would preserve two owners and
only mask their race. Other admin routes remain native WordPress documents, and
the dedicated Settings document continues to use WordPress's registered React
runtime, Nonces, REST APIs, and settings persistence.

The existence of a Root is not a resource-admission condition.
PHP first decides whether to output an entrypoint based on the admin Screen, Supported Post Type, Capability, and actual resource contract; the entrypoint then validates Bootstrap, DOM, WordPress runtime, and Manifest.
Mounting, unmounting, failure, cancellation, repeated entry, and teardown must release their listeners, Observers, Timers, temporary DOM, focus, scroll, locks, and asynchronous work.

## 3. Features, Ports, and Adapters

Code is organized by user-recognizable capabilities such as `markdown-editor`, `live-preview`, `toolbar`, `appearance`, `custom-css`, `media`, `local-drafts`, `wechat-export`, and `ai-assistant`.
Create a Feature directory, Store, Provider, Port, Adapter, or shared Primitive only when a real consumer exists; do not create empty paths, placeholder modules, or generic catch-all directories for an ideal end state.

- A Feature expresses a complete user capability and owns its local state, events, and failure presentation.
- Domain contains only pure rules that do not depend on React, the DOM, WordPress, the network, or Storage.
- A Port expresses one stable external capability, result, failure, and cancellation boundary.
- An Adapter connects WordPress, REST, DOM, Media, Storage, or Clipboard and handles parsing, authorization-error mapping, cancellation, stale results, and cleanup at the boundary.
- Runtime assembles the capability slices actually owned by the current Root; it does not declare a universal `EditorAdapter`, `WordPressService`, or `execute(type, payload)`.

Features do not read WordPress globals, Bootstrap, REST clients, Storage, Clipboard, or DOM selectors directly, and they do not construct concrete Adapters.
The entrypoint assembles the real Runtime; cross-Feature dependencies use only narrow public APIs and remain acyclic.
Before choosing a new component or dependency, inspect existing EasyMDE and WordPress capabilities and native semantic controls; introduce the smallest maintainable implementation only when a verified interaction responsibility cannot be handled by them.

## 4. State and Operation Authority

Persistent state belongs to PHP and WordPress, server-derived state is managed by one explicit owner, and editing-session state is managed by the nearest Feature or by the Root when cross-Feature coordination is genuinely required.
Derived Dirty, statistics, and capability state are not copied into independent truths; recovery data enters only a versioned Local Draft Store isolated by Site, User, and Post, and it is never an implicit replacement for article saving.

Preview is the only formal Safe HTML sink: Markdown passes through `PreviewPort` to PHP `EasyMDE\Content\MarkdownRenderer`, and the returned sanitized HTML is enhanced by local Mermaid, KaTeX, Highlight.js, and TOC enhancements.
The browser does not render another Markdown copy or mask PHP Renderer or Composer dependency failures with an approximate result.

Save, Publish, Restore, Upload, Settings, Custom CSS, and Clipboard operations must start from an explicit user action, await the real WordPress or browser owner's result, and then update interface state.
Opening, closing, focusing, Previewing, cancelling, fallback, and teardown must not hide writes, and Browser Abort must not be interpreted as cancellation of a server Mutation.

Every asynchronous capability is bound to the current Site, User, Post, Root, and Feature identity and declares latest-wins, single-flight, parallel-keyed, or ordered semantics.
Old requests, closed Dialogs, replaced Surfaces, and unmounted Roots cannot change current state.
Expected failures enter stable Error Codes and visible states, while diagnostics record only the minimum privacy-safe context.

## 5. Public Compatibility and Theme Boundaries

EasyMDE preserves its existing public Facade, Filters, Actions, REST namespace, Theme IDs, Command IDs, Script Handles, ordering, collision, and failure behavior.
This especially includes:

```text
EasyMDE_Plugin::register_toolbar_button()
EasyMDE_Plugin::register_shortcode_helper()
easymde_supported_post_types
easymde_article_themes
easymde_code_themes
easymde_revision_restore_failed
easymde/v1
```

Extension descriptors must be versioned and validated data that does not execute arbitrary JavaScript, pass React Elements or Components, or expose internal Stores, Adapters, or private DOM.
Before tightening field meanings or removing a boundary, complete a consumer inventory, compatibility tests, migration, and human approval.

Article Theme, Code Theme, and the shared Mac code frame are three independent CSS owners.
Article Theme owns article presentation, Code Theme owns the token palette, and the shared frame owns fixed code-frame geometry; they must not copy one another's selectors or become hidden overrides for another surface.
Each Article Theme may associate its own default Code Theme, but a valid explicit user selection always wins, and a missing or invalid fallback is not written back on open.

Font options are deduplicated by effective font stack and fallback semantics, while historical IDs remain compatibility aliases.
Redistributable runtime JavaScript, CSS, Font, Icon, and SDK assets use locally locked sources and are delivered by the installable package; a true External Service additionally requires focused approval, privacy and Consent, minimum data, authentication, a failure contract, an update owner, and a removal plan.
CDNs and remote static scripts are not replacements for local resources.

## 6. Maintainability Principles

EasyMDE architecture prioritizes data authority, WordPress compatibility, extension stability, error visibility, accessibility, and reproducible delivery.
React code should remain local, composable, testable, and removable; abstractions require a real responsibility and consumer rather than a file-count or popularity rationale.
Performance optimization starts with representative measurement and must not sacrifice Selection, IME, Undo, Focus, Scroll, the Native Form, or failure traceability.

Accessibility is not decoration: keyboard behavior, IME, focus entry and exit, Dialog, Toolbar, Split Pane, RTL, zoom, text resizing, Reduced Motion, Forced Colors, and long translations belong to the contract of the corresponding interface owner.
Public pages continue to be rendered by PHP and do not load the admin React application.

WeChat is compatibility export, not a persistence or publishing path.
This document preserves only that boundary; serialization implementation belongs to `.agents/skills/easymde/references/wechat-export.md`, decision rationale belongs to [ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md), verification steps belong to [Testing and Release](TESTING_AND_RELEASE.md), and user-observable behavior belongs to [User Guide](USER_GUIDE.md).

When a stable boundary changes, update the corresponding current owner first, then update this document's long-term rationale and routes, and remove obsolete rules instead of adding contradictory exceptions.
All testing, browser, performance, accessibility, review, and release conclusions must be based on actually executed evidence.
