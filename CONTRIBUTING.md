# Contributing

`AGENTS.md` owns repository-level invariants and authorization boundaries.

`CONTRIBUTING.md` owns the detailed public contribution workflow, authoritative
template routing and applicability, Git and push sequence, local review, CI
coordination, remote review, finding quality, and public-evidence procedure.

React, UI, accessibility, browser, architecture, and security implementation
rules belong to `.agents/skills/easymde/SKILL.md`.

EasyMDE is a standalone WordPress Markdown editor. Contributions must preserve
WordPress-native editing, permissions, media, revisions, saving, publishing,
and release behavior. Read [AGENTS.md](AGENTS.md) before material
implementation, security, compatibility, migration, or release work.
[Core Philosophy](docs/CORE-PHILOSOPHY.md) is an optional mnemonic
introduction; it does not define a second set of binding rules.

## Contributor Applicability

The repository workflow, focused Issue and pull request scope, explicit
path-based staging, applicable validation, privacy-safe public evidence,
accurate CI and unverified-result reporting, independent verification of Bot
findings, human merge and closure control, and private security-reporting
requirements apply to all contributors.

Agents, Codex, and other automation additionally require explicit authorization
in the current human request before any remote repository write. Agent-authored
or automated work must use the Local Codex Review below; its pull request
updates must also use exact-Head CI and the complete CodeRabbit request
workflow. A new push invalidates conclusions for an earlier Head.

Human contributors do not need a separate "current human request" before
pushing to a branch they are permitted to update, and the absence of a local
`codex-review` tool does not block their commit or push. They may voluntarily
use the Local Codex Review and CodeRabbit templates, while remaining subject to
repository permissions, applicable CI and review, privacy requirements, and
human maintainer control of merge, closure, auto-merge, and remote branch
deletion.

## Repository Workflow

- Inspect the live repository and relevant public consumers before editing.
- Keep each change focused on its linked Issue and preserve unrelated work.
- Prefer the smallest independently testable change and avoid formatting churn
  or unrelated refactors.
- Add a dependency, abstraction, service, asset, script, document, generated
  artifact, or new file only when it has a current runtime, build, test,
  release, or documented extension responsibility.
- Update [Architecture](docs/ARCHITECTURE.md) only when current implemented
  architecture changes.
- Update [React Design Philosophy](docs/REACT_DESIGN_PHILOSOPHY.md) only when a
  durable React design rationale or boundary changes.
- Update [Testing and Release](docs/TESTING_AND_RELEASE.md) when current quality
  gates or release execution changes.
- Update [Migration](docs/MIGRATION.md) when implemented data-model,
  compatibility, migration, or upgrade behavior changes.
- Update [Upgrading EasyMDE](UPGRADING.md) when user-facing upgrade, rollback,
  or operator guidance changes.
- Update `README.md` for user-visible behavior changes.

## Branches and Pull Requests

- Branch from the current `main`.
- Keep pull requests focused on one behavior, fix, or documentation goal.
- Prefer small, logical Conventional Commits for completed work. Use normal
  pushes. Do not reset, rebase, amend, rewrite published history, or force-push
  without explicit prior maintainer approval for that exact operation.
- Do not merge, squash-merge, rebase-merge, enable auto-merge, close an Issue or
  pull request, or delete a remote branch without explicit human maintainer
  authorization for that action.

## Git Scope, Staging, and Commit

- Do not stage or commit files unrelated to the current task.
- Do not run `git add .`, `git add -A`, or `git commit -a`.
- Stage files explicitly by path only after reviewing them.
- Before each commit, inspect:

  ```bash
  git status --short
  git diff
  git diff --cached
  ```

- Do not stage pre-existing changes made by another person or task.
- Do not stage local-only, generated, temporary, or machine-specific files
  unless the task explicitly requires a release artifact. This includes:

  - `.env`, credentials, tokens, cookies, and local configuration;
  - `node_modules/`;
  - local logs, caches, backups, screenshots, archives, browser reports, and
    test output;
  - IDE settings and operating-system metadata;
  - generated vendor or build output not required by release policy.

- Do not add placeholder files, unused assets, abandoned experiments, duplicate
  stylesheets, or speculative documentation.
- A new file must have a current consumer or be an explicitly requested
  deliverable. Explain the purpose and reference path of an intentionally
  standalone file.
- Do not modify `.gitignore` merely to hide artifacts created by the current
  task.
- Do not create a commit until the focused work can stand alone and applicable
  validation has completed. Agent-authored or automated work must also complete
  the Local Codex Review below; human contributors may use it voluntarily.
- For agents and automation, a push, remote pull-request mutation, review
  comment, label change, or other remote repository write requires explicit
  authorization in the current human request. Authorization for one remote
  action does not imply another.

## Validation Expectations

Use the live repository scripts and run the smallest checks that exercise the
changed path. Do not invent commands or report an unexecuted check as passing.
When the verified reusable local CI Docker image is available, local CI and
PHPUnit validation must prefer `scripts/run-ci-image.sh`; do not rebuild the
image or download its resources for every test run. Rebuild only when its
identity verification fails or an owned pinned input intentionally changes.
The complete offline image and resource contract is in
`docs/TESTING_AND_RELEASE.md`.

For PHP changes, start with:

```bash
composer validate --no-interaction --no-check-publish --strict
composer install
git ls-files -z -- '*.php' | xargs -0 -n1 php -l
composer run lint:phpcs
composer run test:phpunit
```

For JavaScript, assets, notices, or release scripts, start with:

```bash
npm install
npm run assets:check
git ls-files -z -- '*.js' '*.mjs' | xargs -0 -n1 node --check
npm run i18n:check
npm run notices:check
npm test
```

Run `npm run prepare:assets` only when intentionally updating a locked
runtime package or its manifest-owned local files. Review and commit the
resulting asset, lockfile, notice, and manifest changes together; CI and
release validation do not repair drift.

For documentation-only changes, run:

```bash
git diff --check
```

Also verify changed Markdown links, routes, Skill paths, frontmatter identities,
and fenced blocks.

For release-impacting changes, follow
[Testing and Release](docs/TESTING_AND_RELEASE.md), including release ZIP,
source archive, clean-install, Plugin Check, and Chromium E2E validation where
applicable.

## Adversarial Pre-Delivery Review

Before committing, pushing, opening or updating a pull request, or declaring a
task complete, review the exact current change as a skeptical maintainer:

- **Logic and data flow:** trace unexpected input, Hook order, early returns,
  races, retries, missing dependencies, partial failure, cancellation, stale
  completion, and teardown.
- **Facts and contracts:** compare the implementation with supported WordPress
  and PHP versions, live dependencies, public APIs, metadata, migration,
  privacy, distribution channels, and release packaging.
- **Simplicity and scope:** check whether a smaller focused change solves the
  real problem and remove unnecessary dependencies, files, abstractions,
  configuration, artifacts, and unrelated edits.
- **Test validity:** confirm tests reach the changed path and cannot pass only
  through broad mocks, polluted global State, unavailable or skipped tooling,
  reimplemented production logic, or file-presence assertions.
- **Privacy and provenance:** inspect code, generated output, binaries, data
  URIs, commit text, public Issue/PR text, and evidence for secrets, personal
  data, private content, local-environment details, and unnecessary embedded
  metadata.

List the three to five most likely ways the change could fail. For each
relevant risk, reproduce or test it, fix the root cause and rerun affected
checks, or record why it remains unverified. Report only commands, environments,
and evidence actually used; “looks correct,” “should work,” one happy-path
test, or an old-SHA result is not completion evidence.

## Issue and Pull Request Workflow

### Mandatory Issue Linkage

- Before implementing a substantive change, search open and closed Issues for a
  report, requirement, maintenance task, or design decision that covers it.
- Reuse an existing Issue when its scope and acceptance criteria match.
- If no suitable Issue exists, create a focused Issue before opening a pull
  request. Do not create a placeholder Issue merely to satisfy linkage.
- Every pull request references at least one relevant Issue.
- Use `Closes #123`, `Fixes #123`, or `Resolves #123` only when the pull request
  fully satisfies the Issue acceptance criteria.
- Use `Related to #123` for partial, exploratory, blocked, or staged work.
- Do not claim an Issue is resolved while known required work remains outside
  the pull request.
- Keep each pull request within its linked Issue scope. Unrelated work requires
  a separate focused Issue and pull request unless a human maintainer explicitly
  expands the current scope.
- Issue linkage does not prove mergeability. Validation, compatibility,
  privacy, CI, and review requirements still apply.
- Keep every complete sentence in a public Issue or pull request body on one
  source line. Do not insert hard line breaks inside a sentence only to wrap
  Markdown at a preferred column; let GitHub wrap rendered prose. Break lines
  only at paragraph, list-item, code-block, or other intentional semantic
  boundaries, and verify the rendered body before continuing the workflow.

For security-sensitive work, use GitHub private vulnerability reporting, a
private security advisory, or another maintainer-approved private channel. If a
public reference is required, use a sanitized tracking Issue with no exploit
details, secrets, private endpoints, or affected-user data.

### Authoritative Version Tracking Issues

Every authoritative version bump requires its focused, long-running version
tracking Issue before the version-changing commit. An authoritative bump is any
change to a different exact target version in one or more of these canonical
release identity fields: the plugin header in `easymde.php`, `EASYMDE_VERSION`,
the `readme.txt` Stable tag, the root `package.json` version, the top-level
`package-lock.json` `version`, or `package-lock.json` `packages[""].version`.
Increments, prereleases, retargets, and rollbacks all count. A dependency
version change, a changelog-only change, or a correction that brings a field
back into alignment with an already declared target does not create another
version Issue; update the existing target Issue instead.

For each exact version string and declared release-channel set, maintain exactly
one tracking Issue. The Issue's GitHub `createdAt` timestamp must be earlier than
the earliest commit that contains the version change. The tracking Issue is an
auditable release index; it is not an umbrella implementation scope, a substitute
for focused Issue gates, or merge authority. Every material implementation or
correction still needs its own focused Issue and linkage.

Create and maintain the tracking Issue as follows:

- Record the exact target version, lifecycle (`planned`, `preparing`,
  `candidate`, `published`, `deferred`, or `abandoned`), prior/base version or
  commit, and the required and optional release channels. The current required
  channel and the evidence that makes a candidate formal are defined in
  [Testing and Release](docs/TESTING_AND_RELEASE.md#version-tracking-and-formal-release).
- For every material change, record its focused Issue, PR or merged commit,
  one privacy-safe sentence describing the change or category, and separate
  changelog and release-note dispositions. Each disposition must independently
  be one of: included with the exact section, bullet, or location; omitted as
  non-user-visible with the reason; or deferred with the destination Issue or
  version.
- While preparing a candidate, record the candidate PR and exact SHA together
  with the validation and review result. Once formally released, record the
  exact tag, reviewed release-commit SHA, channel URL(s), public artifact name
  and SHA-256, publication time, and the separate changelog and release-note
  dispositions with their applicable exact locations, reasons, or destination
  Issues/versions. [Testing and Release](docs/TESTING_AND_RELEASE.md#version-tracking-and-formal-release)
  owns the meaning of these evidence states.
- Update the same Issue whenever included work is merged, reverted, deferred,
  or its changelog or release-note disposition changes. Do not use one umbrella
  Issue to bypass the focused Issue requirement.
- Use `Related to #N` as the canonical linkage for the tracking Issue. In a
  version-preparation PR title, body, or commit message, never use `Closes`,
  `Fixes`, `Resolves`, or any case, tense, punctuation, or owner/repository
  variant of those keywords for the tracking Issue, such as
  `Fixes tao-xiaoxin/EasyMDE#205`. A preparation PR may use a closing keyword
  for a focused implementation Issue only when it fully satisfies that Issue.
- Publication never closes the tracking Issue automatically. A human maintainer
  must independently verify the formal-release evidence and record separate,
  explicit closure authorization; an agent or bot must not infer that authority
  from a tag, release, merge, CI result, or Issue state.
- A deferred or abandoned target records its reason and remains open long-term.
  A different exact target, including a retarget or rollback, requires a new
  tracking Issue before any canonical field changes; leave the old Issue open
  with `deferred` or `abandoned` and its reason. Never create a duplicate Issue
  for the same exact target and channel set. A same-target correction before
  publication stays on the same tracking Issue. After publication, use a new
  focused correction Issue; if that correction changes the version, create the
  new patch-version tracking Issue before changing fields. A same-version
  replacement records both artifact/commit identities and the related incident
  on the correction record. All required channels must be complete before the
  target is treated as formally published.

### Human Confirmation for Closing and Merging

Closing and merging are human maintainer decisions.

- Agents, bots, and automations may recommend closure or merge but must not
  perform or arrange either action without explicit human authorization.
- Green CI, a bot approval, resolved threads, completed acceptance criteria,
  inactivity, or a superseding change is not closure or merge authorization.
- A closing keyword may remain in a pull request body, but the linked Issue may
  close only as a consequence of a merge explicitly authorized by a human.
- A request to implement, review, update, commit, push, test, or prepare a pull
  request does not imply permission to merge, enable auto-merge, close, or
  delete a branch.
- When work appears complete or obsolete, report the evidence and wait for the
  maintainer's decision.

## Local Codex Review Before Commit and Push

A passing local `codex-review` is mandatory before committing and pushing
agent-authored or automated work. Human contributors may use this workflow
voluntarily and are not blocked when the tool is unavailable. The review is
read-only; the implementing agent or contributor independently verifies and
resolves its findings.

For agent-authored or automated work, follow this sequence:

1. Complete the focused implementation and applicable local validation.
2. Inspect `git status --short`, `git diff`, `git diff --cached`, commits and
   diff against the intended base, and task files intended for inclusion.
3. Invoke local `codex-review` in read-only mode with the complete template
   below.
4. Independently verify every finding against current files and execution
   paths.
5. Fix confirmed actionable findings, rerun affected checks, and record concise
   evidence for rejected invalid, stale, or out-of-scope findings.
6. Rerun local review after a material change to production code, tests, build
   scripts, dependencies, packaging, permissions, data handling, or another
   reviewed path.
7. Commit only when no confirmed merge-blocking local finding remains.
8. Before pushing, confirm the passing review covers the exact outgoing commit
   set, index, working tree, and intended task files. Rerun it if that state
   changed.
9. Push only after the exact outgoing state has a passing local review and its
   applicable validation remains green.

Additional rules:

- Local review must not edit, stage, commit, push, create or close Issues or
  pull requests, merge, enable auto-merge, change metadata, resolve threads, or
  delete branches.
- Review current local paths and line numbers, not stale PR rendering or older
  review positions.
- A finding is evidence to investigate, not an instruction that overrides the
  live repository or current task.
- Reject false positives instead of adding defensive or unrelated changes for a
  reviewer score.
- Do not suppress, omit, or relabel a confirmed problem to obtain approval.
- Keep prompts and output free of secrets, private content, personal data,
  absolute local paths, private endpoints, raw logs, HAR data, browser storage,
  and unnecessary machine details.
- When no merge blocker remains, the final review states exactly:
  `No merge-blocking findings found in the current local branch.`

### Local Codex Review Prompt Template

The canonical reusable body is [docs/templates/LOCAL_CODEX_REVIEW.md](docs/templates/LOCAL_CODEX_REVIEW.md).

## Push, CI, and CodeRabbit Review Order

This sequence is mandatory for every agent-authored or automated pull request
update. Human contributors may opt in when the tools are available.

1. Complete implementation and local validation.
2. Run local `codex-review`, verify findings, fix confirmed problems, rerun
   affected checks, and repeat until no merge blocker remains.
3. Create the focused commit only after review covers the exact staged and
   working-tree state.
4. Confirm the same passing review still covers the exact outgoing commit set.
5. Push normally after explicit authorization.
6. Record the pull request Head SHA and observe every required check for that
   exact SHA.
7. If a check fails, is cancelled unexpectedly, or times out, inspect the job,
   step, and available logs before deciding whether to fix or rerun.
8. Fix root causes, rerun affected local validation and review, push a focused
   correction, record the new Head, and restart CI observation.
9. Request CodeRabbit only after all required checks for the current Head are
   successful or intentionally skipped by repository policy.
10. Post the complete applicable template, never a bare bot command.
11. Do not request remote `@codex` review as part of this workflow unless a
    human separately authorizes it.
12. After posting, wait for acknowledgement or review activity. Unless the
    review finishes earlier, observe for at least 15 minutes at reasonable
    60–90 second intervals, checking comments, reactions, reviews, threads,
    walkthrough updates, and CI.
13. Independently verify every CodeRabbit finding. Fix confirmed defects. Reply
    to invalid or stale findings with concise privacy-safe evidence when the
    contributor has repository permission and, for agents or automation,
    explicit authorization for that remote comment; otherwise report the
    evidence to the human maintainer. Do not change the project merely to
    obtain Bot approval.
14. A push after review starts creates a new Head and invalidates CI and review
    conclusions tied to the old SHA. Repeat local review, CI, and the complete
    re-review template for the new Head.

Do not:

- commit or push while local review is blocked, stale, incomplete, or has an
  unresolved confirmed finding;
- request CodeRabbit while required CI is queued, running, failing, cancelled,
  or stale;
- post a bare `@coderabbitai full review` or duplicate a request that may still
  be queued;
- leave literal placeholders, copied validation claims, stale SHAs, or checks
  that were not run in a CodeRabbit request;
- classify a failure as flaky before inspecting evidence;
- reuse a green run, walkthrough, approval, or review from an earlier SHA;
- push empty commits, formatting churn, or unrelated edits to retrigger CI or a
  bot;
- ask CodeRabbit to edit, push, merge, close, change metadata, enable
  auto-merge, delete branches, or resolve threads;
- merge while required CI is incomplete or failing or while a confirmed local
  or remote review finding remains unresolved.

A slow response is not a failed request. Retry once only when concrete evidence
shows the request failed, was not accepted, was cancelled, its stated
rate-limit window expired, or no acknowledgement appeared after a reasonable
wait. Before retrying, confirm the Head is unchanged, exact-Head CI is still
green, and no review is queued or in progress. Resend the full template and do
not repeatedly retry the same Head. Report continued unavailability to the
human maintainer instead of creating comment spam. When CodeRabbit is rate
limited, keep the already-green Head unchanged, wait for review capacity, and
send at most the one permitted complete request for that same SHA.

A reaction, acknowledgement, status comment, updated walkthrough, queued check,
or in-progress review is evidence that the request was accepted. Continue
waiting instead of posting another request.

### Mandatory CodeRabbit First-Review Template

The canonical reusable first-review and re-review bodies are in [docs/templates/CODERABBIT_REVIEW.md](docs/templates/CODERABBIT_REVIEW.md).

### Mandatory CodeRabbit Re-Review Template

The canonical reusable first-review and re-review bodies are in [docs/templates/CODERABBIT_REVIEW.md](docs/templates/CODERABBIT_REVIEW.md).

After posting either template, wait for acknowledgement or review activity.
Do not send another CodeRabbit mention merely because the response is slow.

## Issue Body Template

Use this structure for a new public Issue. Remove sections that genuinely do not
apply, but do not omit scope, acceptance criteria, or privacy review for
material work.

The canonical reusable body is [docs/templates/ISSUE.md](docs/templates/ISSUE.md).

## Pull Request Body Template

Use this structure for every pull request. Replace the first line with the
correct closing or non-closing reference.

The canonical reusable body is [docs/templates/PULL_REQUEST.md](docs/templates/PULL_REQUEST.md).

## Code Review Guidelines

Understand the stated goal, exact diff, immediate execution paths, relevant
project constraints, and behavior promised unchanged. Review as a maintainer,
not as a style linter. Tailor the review to the actual change. If no concrete,
actionable issue was introduced or materially worsened, return no findings.

### Review Scope

Review the relevant changes for:

- functional correctness, regressions, edge cases, and failure handling;
- WordPress APIs, capabilities, nonces, REST, metadata, revisions, escaping, and
  native save/publish behavior;
- unsafe Markdown, HTML, CSS, media, clipboard, SVG, Mermaid, KaTeX,
  Highlight.js, extension data, browser storage, and DOM insertion;
- backward compatibility for metadata, posts, revisions, extension APIs,
  themes, settings, hooks, filters, handles, ordering, collisions, and failures;
- integrity between Markdown, `post_content`, appearance, Custom CSS, and
  revision restore;
- performance and resource-exhaustion risks;
- the necessity and integration of dependencies, assets, build files, scripts,
  generated artifacts, abstractions, and documentation;
- release self-containment and distribution-channel compatibility;
- whether tests and evidence cover the actual changed behavior.

### Privacy, Secrets, and Artifact Metadata Review

Treat introduced or worsened privacy, secret, personal-data, local-environment,
or unnecessary embedded-metadata exposure as merge-blocking.

Review changed files and public surfaces controlled by the pull request,
including title/body, linked Issues, review replies, committed or attached
evidence, and generated release artifacts. Flag:

- machine-specific paths, usernames, home directories, temporary paths, local
  logs, caches, screenshot paths, private/staging/loopback endpoints, and ports;
- credentials, keys, tokens, passwords, cookies, authorization headers,
  private keys, and local configuration;
- unnecessary personal data or unredacted records;
- EXIF, XMP, IPTC, creator-tool, document/instance ID, geolocation, or comparable
  metadata in images, fonts, archives, binaries, SVG, or data URIs;
- local-only evidence copied into committed or public material.

Inspect decoded binary or embedded content where practical. A visual match or
successful render does not prove an asset is safe to publish.

Do not repeat sensitive values in a finding. Identify the surface and exposure
category, use redacted examples, and describe the smallest safe remediation.
When history rewriting is separately authorized and required, explain that
rewriting a branch or editing a comment cannot guarantee deletion from caches,
notifications, forks, mirrors, or provider object storage.

### What Deserves a Finding

Report an introduced or materially worsened concrete problem, including:

- a functional regression or broken author, administrator, visitor, extension,
  or release-consumer workflow;
- weakened authorization, unsafe rendering/input, or other security failure;
- unauthorized cross-user or cross-post access;
- data loss, metadata corruption, revision inconsistency, or migration risk;
- incompatibility with supported WordPress/PHP or public contracts;
- meaningful performance, reliability, availability, or resource risk;
- missing dependency, asset, translation, build output, or release artifact;
- public privacy, secret, personal-data, machine-environment, or metadata leak;
- violation of a current explicit repository rule;
- an artifact or abstraction with no current responsibility.

Explain the factual impact of a merge-blocking finding rather than relying on a
severity label.

### What Not to Report by Default

Do not report:

- personal formatting or low-impact naming preferences;
- unrelated refactors or hypothetical future requirements;
- wording, punctuation, or typos without user-facing or contract impact;
- broad architecture rewrites when a focused correction is sufficient;
- generated files required by the documented build/release strategy;
- unrelated pre-existing issues unless the change touches, worsens, exposes, or
  depends on them;
- missing tests merely because tests are absent.

Raise these only when they materially affect correctness, security,
compatibility, maintainability, privacy, release reliability, or an explicit
project rule.

### Generic Pull Request Review Checklist

Apply only the relevant items:

- Request input is unslashed, validated, sanitized, and escaped for its actual
  context.
- Every state-changing operation verifies nonce and the target capability.
- New admin actions do not affect unrelated posts, users, settings, or admin
  pages.
- Markdown, HTML, DOM, Custom CSS, media, extension, storage, and preview sinks
  preserve their declared trust boundary.
- Raw Markdown HTML and unsafe Custom CSS do not become executable output.
- `_easymde_markdown`, `post_content`, revisions, metadata-existence behavior,
  and public compatibility APIs remain consistent.
- Existing Article Theme and Code Theme choices, Custom CSS snapshots, Font
  settings, Shortcuts, and user defaults remain readable unless the focused
  change includes an explicit compatibility and migration path.
- WordPress remains authoritative for save, publish, media, revisions, settings,
  permissions, locks, taxonomies, and unknown extension-owned form fields.
- Assets load only where needed and follow the approved local/remote and
  distribution-channel contract.
- Dependencies have a current owner, compatible license, required notices,
  tests, removal strategy, and correct package inclusion.
- Installable ZIP and source archive contracts remain distinct.
- Public descriptions, fixtures, evidence, and artifacts contain no private or
  unnecessary metadata.

### Finding Quality Requirements

Every independently fixable finding includes:

1. The current repository-relative file and line or execution path.
2. What is wrong.
3. A realistic trigger.
4. Concrete user, security, compatibility, data, performance, test, build, or
   release impact.
5. The smallest focused correction direction.
6. Whether it blocks commit, push, or merge, with a factual reason.

Do not use vague labels without impact, base a finding on preference or a
hypothetical future change, or combine unrelated problems.

### Review Output Rules

- Be concise, direct, actionable, and evidence-based.
- Distinguish confirmed issues from assumptions and questions.
- Ask when repository evidence is genuinely insufficient.
- Prefer one finding per independently fixable issue.
- Do not impose a required severity taxonomy.
- Do not add praise, summaries, suggestions, or findings to fill a quota.
- Do not claim tests, runtime behavior, or security properties not verified.
- Redact sensitive values unless exact reproduction is necessary for an
  immediate security incident in an approved private channel.

## Public Evidence and Privacy Rules

- Public Issues, pull requests, commits, review replies, release notes, and
  documentation include only the evidence needed for review.
- Prefer sanitized descriptions, reduced cases, synthetic fixtures, and
  redacted excerpts over raw logs, screenshots, HAR exports, database dumps,
  browser storage, private article content, or local configuration.
- User-provided screenshots, mockups, recordings, exports, and files are
  reference-only by default. Do not commit, attach, mirror, or republish them
  without explicit publication authorization and content/metadata inspection.
- Never publish secrets or personal data. Later redaction does not guarantee
  removal from caches, notifications, forks, mirrors, or provider storage.
- If sensitive data has entered reachable branch history, stop normal work,
  revoke or rotate credentials where applicable, remove the value only through
  an explicitly authorized remediation, and report remaining exposure limits.
- Keep sensitive evidence in an approved private security or maintainer channel
  and publish only a privacy-safe summary.

### WeChat Clipboard Evidence

Treat WeChat paste output as a browser integration boundary, not as a static
HTML snapshot. For a copy or rendering change:

- Use `docs/examples/markdown-full-capability-test.md` or an equally synthetic,
  reviewed fixture. Capture the source Preview and the pasted WeChat result at
  the same controlled viewport and from the exact current build; a screenshot
  from another draft, browser profile, session, or build is not current evidence.
- Verify the single serializer's HTML in both modern Clipboard API and legacy
  compatibility paths. Compare the payloads, then inspect pasted DOM for the
  removed KaTeX `.katex-mathml` tree, source classes/transient attributes,
  unsafe URLs, hidden controls, exporter-owned structural markers, and the
  expected visual tree. Hidden SVG `<defs>` subtrees referenced by visible
  clip-path/mask/gradient/filter attributes must remain. Safe image
  `src`/`srcset` and link URLs may remain;
  remote CSS backgrounds must not.
- When approved theme images are present, delay one image request and verify
  that modern `Clipboard.write` starts while the originating user activation is
  still active; confirm deferred HTML and plain-text payloads resolve from the
  shared cache and that a fast write cannot report success when that payload
  later rejects. Confirm legacy compatibility succeeds only after preparation
  has completed and invokes `execCommand` synchronously in the originating
  click task; a pending approved image or rejected modern write must not cross
  an `await` and then enter legacy. A synchronous `ClipboardItem` construction
  or `write()` invocation failure may use the current payload when synchronous
  preparation completed in that same click task; a pending approved image still
  fails until preparation resolves. Cover both branches separately.
  During a layout-only replacement, verify that the last resolved payload stays
  available to legacy while the source markup is unchanged, that a successful
  replacement supersedes it, that a failed replacement restores the newest
  successful same-source payload even when an older overlapping refresh
  resolves first, and that changed source markup cannot reuse the older payload.
  Preparation generations must be monotonic so an older completion cannot
  downgrade a newer successful fallback; a scroll-only change in viewport
  coordinates must not invalidate a payload when dimensions and computed
  layout are unchanged.
  Verify modern plain-text extraction measures the connected export surface at
  the rendered Preview width, and reuses the last non-zero visible Preview
  width when immersive source mode hides the surface. When WeChat export is
  disabled, verify that no background preparation or approved theme-image
  request starts. If legacy has no prepared entry after a
  transient preparation failure, verify that the first click starts one
  background retry but still reports failure; only a later click may use the
  retry after it resolves.
  Also hold an approved theme-image request open long enough to verify the
  ten-second abort timeout, cache eviction, and explicit copy failure; do not
  treat a permanently pending asset request as a successful or silent state.
- If immersive visual editing is involved, make several rapid edits before
  copying and verify that preparation is coalesced for the same surface; the
  copied payload must not remain from the moment immersive mode opened or an
  earlier edit. Change a root font or article-theme class/style without
  changing `innerHTML` and verify the prepared payload is invalidated before
  copying. Change a responsive computed width or viewport geometry with the DOM
  unchanged and verify that the prepared payload is invalidated before copying.
  Check non-root theme decoration dimensions, positioning, flex sizing,
  float/overflow, and box sizing; verify that generated theme-image dimensions
  are not replaced by generic media bounds, that a single numeric
  `background-size` keeps its missing axis automatic, and that a fixed
  decoration wider than its host is not clamped, repeating theme backgrounds
  retain their materialized CSS declaration instead of flattening to one image,
  mixed non-image background layers such as gradients remain intact, unsafe
  background URLs become `none` slots instead of invalidating the declaration,
  the `background-repeat`/`background-position`/`background-size` longhands
  remain aligned after removed image layers are compacted, visible quoted
  pseudo-element text keeps its image behind the text, every safe image layer
  is materialized once with its source order, size, and position,
  and materialized images remain
  behind copied text, and computed percentage background positions preserve
  centered overlays on both axes, including CSS single-token position defaults;
  verify omitted/`auto` background sizing remains intrinsic, `cover`/`contain`
  map to equivalent `object-fit` sizing, and four-token edge offsets such as
  `right 12px bottom 6px` preserve both edge and offset values;
  verify fixed/sticky source decorations do
  not regain that positioning in copied HTML and static-source offsets are
  neutralized when an overlay creates a relative containing block.
- Resize the browser viewport and, in immersive split mode, resize the source/
  Preview divider without changing the document. Verify that the debounced
  preparation refreshes the legacy payload and that a background preparation
  failure is reported only by the subsequent copy attempt, not while viewing or
  editing.
- Trigger a late image/video load, metadata/resize event, font loading completion/failure, and post-render
  Preview descendant insertion/removal. Verify that the same debounced
  preparation refreshes the legacy payload, removed nodes stop notifying, and
  observer/listener cleanup occurs when the Preview sink or Root is disposed.
  Enter immersive visual Preview and verify the layout observer rebinds to the
  active surface. Change an article theme and save Custom CSS while visual
  editing, then keep the replacement Preview request pending; preparation must
  still refresh after the visual editor is disposed and must not target its
  detached runtime.
- Include an inline image or video in a paragraph and verify that the pasted
  element keeps its computed inline display and margins while receiving only
  responsive size bounds.
- Verify the session boundary as well as the serializer: disabled, inactive,
  empty, loading, or failed Preview states must not invoke Clipboard; repeated
  clicks share one pending operation; Adapter rejection stays a failure; and a
  teardown cannot announce a late success.
- Measure the actual scroll owners for code, tables, and display formulas:
  long content may scroll horizontally, but it must not create a nested
  vertical axis or an exporter-imposed whole-article height. Measure the
  WeChat page/editor shell separately before attributing its scrollbar to the
  copied article. Tables must use the generated block wrapper as their only
  horizontal owner, preserve built-in theme `display:contents`/
  `container-type`/`100cqi` shims, and keep short intrinsic tables centered.
  Verify task-list checkboxes retain checked state as disabled, attribute-
  minimized controls and that arbitrary form controls are absent.
- Inspect screenshots and computed geometry for headings, theme decorations,
  images, code line breaks, tables, inline formulas, and every display-formula
  family listed in `docs/examples/markdown-full-capability-test.md` (integral,
  limit/partial, matrix, equation system/piecewise, statistics, and
  neural-network examples), plus both horizontal edges of at least one long
  code/formula case.
  When Mermaid HTML labels are present, include a flowchart screenshot with
  multi-character non-ASCII labels and inspect the pasted DOM after WeChat's
  sanitizer has rewritten `foreignObject` children. Complete labels must remain
  on one line even when `white-space`, `word-break`, and `<nobr>` are removed;
  verify that any zero-width markers are absent from modern `text/plain`.
  Confirm focus, selection, page scroll, and temporary DOM are restored after
  fallback and after failure.
- Keep browser access limited to the explicitly authorized local authenticated
  session. Do not publish or send an article. Do not commit raw screenshots,
  article content, clipboard payloads, credentials, cookies, tokens, browser
  storage, private URLs, or machine-specific paths; record only sanitized
  metrics and temporary local evidence paths.

The focused serializer tests, frontend build comparison, release package
contract, and required browser evidence are maintained in
`docs/TESTING_AND_RELEASE.md` and the EasyMDE Skill. The architectural choice
is maintained in [ADR-001](docs/decisions/ADR-001-wechat-clipboard-serialization.md).

## Completion Report

Report:

1. What changed and why each changed file belongs to the task.
2. Compatibility, migration, security, privacy, dependency, build, and release
   impact.
3. Commands and checks actually run, with results and exact revision when
   relevant.
4. For agent-authored or automated work, or when a human contributor
   voluntarily used it, the Local `codex-review` scope, exact-state verdict,
   confirmed findings fixed, and rejected findings with concise evidence.
5. CI and remote review status for the exact current Head.
6. The three to five most likely failure modes and how each was tested, fixed,
   or left unverified.
7. Files intentionally audited but unchanged.
8. Remaining risks, assumptions, skipped checks, unavailable environments, and
   unverified behavior.
9. Staged, committed, pushed, or remotely mutated state, without implying merge
   or closure.

## Security Reports

Do not report vulnerabilities in public Issues or pull requests. Follow
[Security Policy](SECURITY.md) for private reporting.
