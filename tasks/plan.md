# Implementation Plan: Lockable Visual Markdown Preview

## Overview

Add a structured visual editing surface to immersive Preview mode while keeping
Markdown as the only canonical document. The implementation must preserve
unmodified source bytes, protect unsupported syntax, reuse the existing source
input and WordPress save pipeline, and keep Edit and Split behavior intact.

## Architecture Decisions

- Use a local, dependency-free `VisualMarkdownModel` with block and inline
  nodes carrying original source slices. A no-op serialization returns the
  exact input; changed supported nodes serialize deterministically.
- Use protected atomic nodes for images, tables, Mermaid, math, TOC, raw HTML,
  and unknown extensions. Their source slices are never reconstructed.
- Keep DOM ownership in `VisualEditorAdapter`. It maps an allowlisted semantic
  DOM to structured nodes and never serializes `innerHTML` to Markdown.
- Keep mode, lock, focus, outline, command routing, and lifecycle state in the
  immersive workspace. All committed visual changes flow through the existing
  `setMarkdown()` bridge and source `input` event.
- Default immersive mode is Edit. First-entry Preview state is Editable because
  that is the Issue contract and observed reference behavior; lock state remains
  session-only and is never stored.
- Add no runtime dependency or remote asset. Existing npm, WordPress, release,
  and local asset workflows remain unchanged except for registering the new
  local scripts.

## Dependency Graph

```text
VisualMarkdownModel + fixtures
  -> VisualEditorAdapter
     -> immersive mode/lock state machine
        -> toolbar and outline routing
           -> styles, accessibility, integration, E2E, release validation
```

## Phases

### Phase 1: Lossless Model

- Add failing Node tests for byte-stable no-op round trips, supported block and
  inline nodes, single-node edits, protected slices, duplicate headings, CRLF,
  fences, lists, and unsafe syntax.
- Implement the structured parser and deterministic serializer.

### Checkpoint: Model

- Focused Node tests pass.
- Every unsupported fixture remains byte-identical when adjacent content changes.
- Parse or serialization errors leave the original Markdown available.

### Phase 2: Visual Adapter

- Add the visual adapter lifecycle, structured semantic rendering, selection,
  transactions, undo/redo, IME deferral, paste sanitization, protected-node
  source routing, and read-only enforcement.
- Add focused tests for state transitions, commands, history, sanitization, and
  listener cleanup.

### Checkpoint: Adapter

- Adapter tests and JavaScript syntax checks pass.
- Locked mutation paths are rejected without a change callback.
- Destroy and remount do not duplicate DOM or handlers.

### Phase 3: Immersive Integration

- Integrate Edit, Split, Preview, Editable, and Read-only states.
- Route toolbar commands to Source or Visual and disable mutation controls when
  no editable surface is active.
- Synchronize canonical Markdown, focus, scroll, drafts, outline, statistics,
  previews, and generation tokens without implicit persistence.
- Make outline targets stable for duplicate headings in every mode.

### Checkpoint: Integration

- Existing immersive Node tests remain green and focused state/outline tests pass.
- Mode and lock transitions make no save, revision, post-meta, or user-meta write.
- Existing normal editor behavior remains unchanged.

### Phase 4: UI, WordPress, and Release Proof

- Add scoped visual-editor styles and localized accessible strings.
- Update architecture and user-facing documentation.
- Extend PHP/integration and Playwright coverage for persistence, rendering,
  security, accessibility, themes, drafts, revisions, media, WeChat, and frontend.
- Compare production and reference UI at 1440x1000, 1280x800, and 390x844.
- Run the full local validation and release-package matrix.

### Checkpoint: Delivery

- Local codex-review returns APPROVE for the exact outgoing diff.
- Focused commits are pushed, the PR targets `main`, exact-head CI is green, and
  CodeRabbit has reviewed the exact head.
- The PR and Issue remain open; no merge, closure, auto-merge, branch deletion,
  or Worktree removal occurs.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A visual edit rewrites unrelated Markdown | High | Source slices, dirty-node serialization, byte equality fixtures |
| Lock is bypassed by an input path | High | Single mutation gate plus typing, paste, drop, shortcut, command, undo/redo tests |
| Stale async work overwrites newer Markdown | High | Generation tokens and rapid-switch browser tests |
| Duplicate headings navigate incorrectly | High | Stable model IDs and occurrence-aware source/visual mappings |
| Editor DOM or CSS leaks into persisted output | High | Existing source bridge only, scoped CSS, persistence and frontend negative checks |
| Large documents become unresponsive | Medium | Parse on entry, debounced transactions, dirty-node serialization, relative measurements |

## Open Questions

None. The linked Issue and supplied execution brief define the required behavior,
boundaries, reference UI, and completion gates.
