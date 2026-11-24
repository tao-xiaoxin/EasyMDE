# ADR-002: Unified ProseMirror Visual-Editing Projection, Local ESM Build, and Frontend Module Guardrails

- Status: Accepted
- Date: 2026-11-22
- Owners: EasyMDE React editor architecture, Vite frontend build, and frontend quality guardrails

## Context

EasyMDE originally implemented immersive live-visual editing by enabling raw `contentEditable` directly on PHP-rendered Preview HTML and synchronizing DOM mutations back to Markdown, while compiling the admin editor into a single monolithic IIFE bundle (`format: "iife"`).

That architecture accumulated three compounding maintenance and reliability costs:

- More than 72,000 lines of fragile visual-editing reconciliation (`ImmersiveVisualEditor.tsx`, `WindowedImmersiveVisualEditor.tsx`, and `visual-markdown.ts`) fighting browser-specific `contentEditable`, selection, IME, undo/redo, and DOM-to-Markdown projection edge cases.
- Dual-engine parity drift between the Full and Windowed visual-editing surfaces across the 160-block windowing threshold (`DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED = 160`), requiring every behavioral fix to be implemented and verified twice.
- A monolithic 2.2 MB single-file IIFE editor bundle (`assets/build/assets/admin-editor-*.js`) that prevents lazy loading of heavy editor subsystems and slows initial load.

## Decision

1. **Preserve PHP and Markdown authority.** `_easymde_markdown` remains the sole canonical Markdown source of truth, and PHP `EasyMDE\Content\MarkdownRenderer` (`league/commonmark`) remains the sole authoritative production renderer for Save/Publish (`post_content`), public visitor pages, read-only Split/Preview panes, and WeChat Clipboard export.
2. **Authorize a unified ProseMirror editing projection for immersive live-visual editing only.** EasyMDE authorizes a dedicated browser-side structured editor core built on ProseMirror core packages (MIT) strictly as a temporary in-memory editing projection for immersive visual editing:
   - It mounts into the existing article theme CSS DOM structure rather than introducing a separate styling system.
   - It treats complex and custom blocks (KaTeX math, Mermaid diagrams, TOC, footnotes, and unknown raw blocks) as raw-source-preserving protected atom cards so unrecognized syntax is never corrupted.
   - Opening, viewing, or closing the visual surface performs zero write-back when no legitimate user edit occurred; legitimate edits synchronize back to canonical Markdown through the existing document owner.
   - It replaces both the Full and Windowed `contentEditable` visual engines with one unified engine.
   - It is never a second persistence store, formal renderer, or substitute for PHP `MarkdownRenderer` or the Preview-owned Safe HTML sink.
3. **Authorize local ES Modules with dynamic code splitting.** EasyMDE authorizes migrating the Vite frontend build from monolithic `format: "iife"` to modern local ES Modules (`format: "es"`) with dynamic code splitting:
   - Target WordPress 6.7+ and `es2020`.
   - Keep all runtime JavaScript, CSS, fonts, and dependencies 100% local and version-controlled (no CDN or remote runtime loading).
   - Continue reusing the WordPress-provided React 18 `wp.element` runtime and preserve public WordPress script handle compatibility.
4. **Enforce frontend module health guardrails.** Enforce single-direction layering (shared contracts under `frontend/src/contracts/`, no upward imports from `contracts/`, `domain/`, or `shared/`, and no cross-feature UI component imports from `editor-context-menu/` into `immersive-editor/ui/`), prohibit new zero-JSX multi-thousand-line `.tsx` controllers, favor cohesive 200–700 line modules, and enforce automated size and layering ratchets in `tests/Node/frontend-architecture-guardrails.test.mjs`.

## Alternatives Rejected

- **Continuing to patch raw `contentEditable` Full and Windowed engines:** Preserves >72k lines of browser-dependent DOM reconciliation and permanent dual-engine parity drift across the 160-block threshold.
- **Promoting a browser renderer to formal Save/Preview/WeChat authority:** Violates EasyMDE's single-renderer invariant and would allow saved `post_content`, public pages, read-only Preview, and WeChat Clipboard output to diverge from PHP `league/commonmark`.
- **Retaining a single monolithic IIFE bundle:** Blocks code splitting of immersive visual editing and other heavy subsystems even though WordPress 6.7+ supports modern local ES module loading.
- **Adopting a full Gutenberg/block-editor rewrite or remote CDN assets:** Violates EasyMDE's standalone Markdown editor identity, local-asset invariant, and WordPress compatibility boundaries.

## Consequences

- Immersive visual editing moves toward one structured, deterministic ProseMirror projection while PHP `MarkdownRenderer` and `_easymde_markdown` remain authoritative for formal rendering, Save/Publish, read-only Preview, public output, and WeChat export.
- ProseMirror packages require locked root `package.json` dependency management, license/notice inclusion, local bundling, and focused browser regression coverage before removing the legacy visual engines.
- Dynamic ESM chunks require explicit WordPress enqueue/module-loader integration and updated build/release verification while preserving public script handles and offline self-contained ZIP packaging.
- Automated Node architecture guardrails prevent new oversized files, zero-JSX `.tsx` controllers, and layering regressions while allowing legacy files to shrink monotonically.

## Verification route

Repository-wide authority boundaries remain owned by [AGENTS.md](../../AGENTS.md), durable design rationale by [DESIGN.md](../DESIGN.md), current implemented ownership by [ARCHITECTURE.md](../ARCHITECTURE.md), executable React and browser rules by [the EasyMDE Skill](../../.agents/skills/easymde/SKILL.md), automated architecture ratchets by [frontend-architecture-guardrails.test.mjs](../../tests/Node/frontend-architecture-guardrails.test.mjs), and build/release checks by [TESTING_AND_RELEASE.md](../TESTING_AND_RELEASE.md).
