# Settings Center Continuation Plan

## Goal

Continue `codex/issue-126-settings-center` in an isolated worktree, merge the
latest `origin/main` without losing validated mainline behavior, and finish the
WordPress-backed Settings Center so its rendered UI and interactions match the
reference workspace. AI-related settings and article synchronization remain
hidden from the Settings Center surface while their existing product contracts
are preserved.

## Scope

- Keep all work in `/root/workspace/EasyMDE-settings-center` on
  `codex/issue-126-settings-center`.
- Preserve and verify the merged mainline editor/theme/runtime changes.
- Run the reference UI locally for source and visual comparison, then run the
  EasyMDE settings page with one browser session/window.
- Complete only Settings Center frontend, settings bootstrap/persistence,
  focused admin template/CSS, tests, build/release metadata, and required
  translations. Do not change unrelated editor or public-page code.
- Keep AI and article-sync navigation/content/search results out of the visible
  Settings Center while retaining truthful server-owned settings boundaries.
- Replace demo-only setting behavior with real WordPress option and native-form
  interactions where the plugin already owns the state.

## Approach

1. Establish the isolated worktree and merge `origin/main`; resolve generated
   language catalogs without dropping either side's translations.
2. Audit the reference UI, current React Settings Center, PHP settings owner,
   bootstrap contract, and existing tests to identify behavior and visual gaps.
3. Implement one bounded settings slice at a time: real option-backed general
   settings, shortcut editing/reset, and truthful About/help actions; keep
   hidden AI/sync exclusion covered by tests.
4. Reuse the supplied Settings Center assets/tokens and compare the full page at
   stable desktop/mobile viewports, including sidebar, sticky header, tabs,
   search, content rows, footer, typography, spacing, and focus states.
5. Run frontend, Node, PHP/i18n, release, and focused browser checks; perform a
   local multi-axis review and fix every confirmed issue before publishing.
6. Commit atomic changes, push the feature branch, open or update a focused PR
   linked to the prior settings-center PR, request the repository bot review,
   and report the verified local URL and evidence.

## Risks

- Settings UI can look complete while silently writing only browser storage;
  persistence must remain WordPress-owned and failures must be visible.
- Generated assets and gettext catalogs can drift after the mainline merge.
- Hiding AI/sync must not accidentally remove their server contracts or expose
  stale search/index entries.
- The reference app may contain demo-only controls that must not become fake
  plugin capabilities.
- Browser visual comparison is sensitive to viewport, font loading, zoom, and
  scroll state; evidence must record those conditions.

## Validation

- `git merge-base --is-ancestor origin/main HEAD` succeeds and the merge is
  committed on the feature branch.
- `npm run i18n:check`, frontend lint/type/tests/build gates, Node tests,
  relevant PHP tests/lint/PHPCS, and release asset checks pass.
- One local reference dev server and one EasyMDE dev/browser session render the
  Settings Center without console errors or failed required assets.
- Browser evidence verifies full-page geometry and interactions: tab navigation,
  search and result navigation, settings changes, reset/cancel/save behavior,
  shortcut editing, hidden AI/sync absence, and keyboard/focus behavior.
- WordPress option/state checks prove successful and failed saves truthfully.

## Completion Criteria

- Settings Center is isolated, merged with current main, implemented within
  scope, and backed by real plugin state.
- The visible UI matches the reference at the compared viewports and has no
  known confirmed interaction gaps.
- All required checks and local review are green; unresolved blockers are
  recorded explicitly rather than hidden.
- The branch is pushed and the PR/bot-review request is created or updated,
  with the final local test URL reported.
