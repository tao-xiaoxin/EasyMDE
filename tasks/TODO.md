# Settings Center Continuation TODO

| Task | Status | Verification / blocker |
| --- | --- | --- |
| Create isolated worktree and inspect branch state | Completed | Isolated settings-center worktree, branch `codex/issue-126-settings-center` |
| Fetch and merge latest `origin/main` | Completed | Merge commit `ba89eca`; `origin/main` is an ancestor; generated catalogs reconciled and `npm run i18n:check` passed |
| Audit reference UI, React settings code, PHP owner, and tests | Completed | Owner-backed general/shortcut fields use REST + option CAS; unsupported fields remain explicitly disabled; AI/article-sync are absent from production navigation/search |
| Run reference UI locally for baseline evidence | Completed | Reference Vite server and one Playwright page captured reference and local screenshots; committed evidence contains no local endpoint |
| Implement real WordPress-backed settings interactions | Completed | Settings REST controller, nonce/capability checks, revision conflict handling, shortcut/editor bootstrap wiring, transfer validation, and save/reload states are present |
| Preserve hidden AI/article-sync surface and add regression coverage | Completed | Frontend tests and E2E assert no AI/comment/article-sync navigation or content; server contracts remain separate |
| Match full-page visual layout and responsive states | Completed | Desktop screenshot geometry matches reference; mobile E2E confirms 390px viewport, 1100px internal crop, no document overflow |
| Run frontend, Node, PHP, i18n, release, and browser verification | Completed | Local frontend 63 suites/756 tests, Node 241 tests, PHPUnit 239 tests/1,904 assertions, build, production comparison, PHPCS, i18n, one-browser settings E2E, and exact-head CI `32107093577` pass |
| Local code review and automatic defect loop | Completed | The Transfer mutation and swallowed startup-failure findings were fixed at their source owners; staged review and CodeRabbit re-review approve the exact pushed head |
| Commit, push, PR linkage, and bot review request | Completed | PR #165 is open at current evidence head `d6db493`; production behavior last changed at `4bad582`, exact-head CI is green, and CodeRabbit returned the required new-head `APPROVE` verdict |

## Verification Log

- `git merge --no-edit origin/main` initially exposed generated gettext conflicts;
  the catalogs were rebuilt from merged sources and committed in `ba89eca`.
- `npm run i18n:compile` and `npm run i18n:check` pass after catalog repair.
- `npm run icons:check`, `npm run lint:frontend`, `npm run typecheck:frontend`, and
  `npm run test:frontend` pass (63 suites, 755 tests).
- `npm test` passes (241 Node tests); `npm run build:frontend` and production
  artifact validation pass after removing duplicate merge declarations.
- `composer run lint:phpcs` passes after enabling the locked WPCS installer.
- Full local PHPUnit now passes (239 tests, 1,903 assertions) after installing the
  WordPress 6.7 test suite against the disposable MySQL service. The first
  hosted run exposed a null `Content-Length` guard, REST generic validation
  errors, stale response ordering, and stale page-test context/string checks;
  each root cause is corrected in the working tree.
- The replacement Node validation exposed a stale gettext POT reference after
  the controller fix; `npm run i18n:make-pot`, `npm run i18n:compile`, and
  `npm run i18n:check` now pass with the regenerated catalog.
- Settings E2E passes 8/8 tests against the isolated WordPress site. The native
  updates-menu check accepts WordPress's available-updates tab
  when an update exists and its all-plugins tab when the disposable site has no
  update, while still asserting the native upgrade route.
- Hosted CI run `32091725671` reached all 28 browser tests but reported two
  test-only contract failures: the native plugin menu rendered `Updates` in the
  English CI locale, and the draft test expected a 15-second write despite the
  page's configured 60-second autosave interval. The assertions now accept the
  supported English/Chinese labels and derive the draft wait/timeout from the
  live bootstrap setting. A one-browser local probe confirmed the 60-second
  draft persists with the real plugin runtime.
- Replacement hosted run `32095066844` reached 27 passing browser tests but
  showed the remaining recovery assertion crossing WordPress's native
  heartbeat autosave boundary after the configured 60-second wait. The test
  now strips only the autosave payload from heartbeat requests during the
  local-draft recovery phase, preserving the native Save assertion and the
  production autosave behavior.
- Correction CI `32101127020` passed 27 browser tests and exposed one valid
  native WordPress label variant, `Update Available (1)`, in the active update
  filter. The E2E matcher now accepts that label alongside the existing English
  and Chinese variants; no production behavior changed.
- CodeRabbit re-review of `c9a0720` found one confirmed Transfer boundary issue:
  import, reset, and clear-cache controls could still mutate browser or draft
  state despite the unavailable notice. The controls are now disabled and the
  mutation dialog path fails explicitly if invoked outside the UI owner.
- The same re-review identified a confirmed startup availability issue: Settings
  Center bootstrap and mount failures logged only a bounded code and left the
  React root blank. The template now provides a translated failure message and
  the entrypoint replaces the root with an accessible error notice while
  retaining privacy-safe bounded logging.
- Exact-head CI `32107093577` passed every required job, including the one-browser
  Chromium suite and release ZIP checks, for commit `4bad582`.
- The first new-head CodeRabbit request returned a concrete service error; the
  one permitted complete retry was accepted and ended with
  `EASYMDE_CODERABBIT_REREVIEW_VERDICT: APPROVE` for `4bad582`.
- Browser console and request-failure capture were empty for reference and local
  Settings Center desktop/mobile captures.
- Local `codex-review` pass: the staged settings/build/release diff was checked
  for state, authorization, validation, compatibility, privacy, and release
  regressions; the ordered-list parser omission was fixed and verified. Final
  verdict: `No merge-blocking findings found in the current local branch.`

## Known Limitations

- Human maintainer review, merge, and closure remain intentionally pending; no
  automation may authorize those actions.
