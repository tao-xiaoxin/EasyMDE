# EasyMDE Agent Notes

## Project Intent

EasyMDE is a WordPress plugin project. Despite the repository name, do not assume the implementation must use the EasyMDE JavaScript library. The product goal is a standalone, full-featured Markdown editor for WordPress with split-pane live preview and a clean writing workflow.

Preferred direction:

- One plugin, no required companion plugins.
- No Jetpack dependency.
- No Classic Editor dependency.
- No global admin redirects or admin-page hijacking.
- Local assets by default.
- Extensible editor features through internal hooks/registries.

## UX Target

The editor should feel like a modern replacement for WP Editor.md:

- Markdown source on the left.
- Live preview on the right.
- Toolbar for common authoring actions.
- Scroll sync.
- Media insertion support.
- Good code, table, image, shortcode, and future extension support.

## Technical Preferences

- Favor TOAST UI Editor or another modern, actively maintained editor if it better satisfies split preview and extensibility.
- Use PHP server-side Markdown rendering through `league/commonmark` unless there is a strong reason to choose otherwise.
- Use WordPress APIs for enqueueing assets, saving post data, sanitizing output, nonces, capabilities, and screen detection.
- Keep integration scoped to editor screens such as post/page editing.
- Avoid converting all content to Gutenberg blocks as the primary storage model.

## Safety Constraints

- Never add activation behavior that traps the administrator on a settings page.
- Never redirect unrelated admin pages.
- Never destructively rewrite existing post content without an explicit migration command.
- Sanitize rendered HTML before output.
- Treat user-authored Markdown as untrusted input at render time.

## Repository Hygiene

- Keep generated dependencies out of git unless there is a deliberate release packaging reason.
- Prefer small, reviewable commits.
- Document user-facing behavior in `README.md`.
- Add implementation notes here when major architecture decisions are made.

## Implementation Notes

- Markdown and code theme choices are saved per post, with the current user's last choice reused as the default for new posts.
- Named custom CSS styles are stored per user; posts store a sanitized CSS snapshot so published content survives later style edits or deletion.
- Editor commands are registered server-side and shipped to the admin UI as a shared command registry. The plugin settings page stores site-wide shortcut overrides per command, with separate Windows/Linux and macOS bindings layered on top of Typora-inspired defaults.
- The editor toolbar is intentionally compact: common authoring actions stay as icons in the top bar, headings live in a popover, and article/code theme controls plus custom CSS live in an appearance panel to keep the split editor surface uncluttered.
- The "Copy to WeChat" action works from the rendered preview, cloning the preview DOM and inlining computed styles for rich-text clipboard export. If the browser lacks clipboard support, the editor must fail with a clear non-destructive message rather than pretending the copy succeeded.
- The built-in Markdown2Html-style article themes are hand-written visual implementations. Markdown2Html may be used as a visual reference, but do not copy GPL-licensed source files or remote decorative image assets into this Apache-2.0 plugin without resolving license compatibility first; recreate ornaments with local CSS by default.
- The current built-in Markdown2Html-style set is md2html-normal, orange-heart, chazi-purple, nenqing-green, green-vitality, red-crimson, blue-ying, lanqing, yamabuki, grid-black, geek-black, rose-purple, ningye-purple, cute-green, fullstack-blue, minimal-black, orange-blue, and frontend-peak.
- The ningye-purple theme is sourced from the captured mdnice rendered writing HTML for theme id 35 because the public markdown-nice repository loads themes from the mdnice API and does not contain a local "凝夜紫" CSS implementation.
