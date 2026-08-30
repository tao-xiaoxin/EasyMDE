# EasyMDE Test Instructions

## Canonical Markdown Content Fixture

* For content-display, Markdown-rendering, editor-preview, article-theme, frontend-output, clipboard/export, Mermaid, KaTeX, syntax-highlighting, table, footnote, task-list, or HTML-sanitization tests, use `../docs/examples/markdown-full-capability-test.md` as the canonical full-document fixture.
* Use the complete fixture for end-to-end or visual coverage when the changed behavior can affect multiple Markdown features. A smaller focused fixture is allowed only for an independently scoped unit or regression test, and it must not replace the full-document validation when broad display behavior changes.
* The canonical document currently references the rounded logo at `https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png`; it is a synthetic public fixture asset, not a locally loaded test image, and must not be replaced with a private image, screenshot, data URI, machine-local path, or unrelated remote placeholder.
* Do not substitute private article content, user screenshots, personal data, local endpoints, or ad hoc sample text merely to make a test pass.
* When a supported Markdown capability or its expected rendering behavior changes, update the canonical fixture and the relevant real rendering assertions together.
* Tests must verify observable rendered behavior. File presence, source-string matching, snapshots without semantic assertions, or a successful fixture load alone are not proof that the affected Markdown features work.
