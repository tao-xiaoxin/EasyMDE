# Contributing

`AGENTS.md` owns repository-level invariants and authorization boundaries.

`CONTRIBUTING.md` owns the detailed public contribution workflow, reusable
templates, Git and push sequence, local review, CI coordination, remote review,
finding quality, and public-evidence procedure.

React, UI, accessibility, browser, architecture, and security implementation
rules belong to `.agents/skills/easymde/SKILL.md`.

EasyMDE is a standalone WordPress Markdown editor. Contributions must preserve
WordPress-native editing, permissions, media, revisions, saving, publishing,
and release behavior. Read [AGENTS.md](AGENTS.md) and
[Core Philosophy](docs/CORE-PHILOSOPHY.md) before material implementation,
security, compatibility, migration, or release work.

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
- Update [Upgrading EasyMDE](UPGRADING.md) for data-model, compatibility,
  upgrade, or rollback changes.
- Update `README.md` for user-visible behavior changes.

## Branches and Pull Requests

- Branch from the current `main`.
- Keep pull requests focused on one behavior, fix, or documentation goal.
- Use normal commits and normal pushes. Do not reset, rebase, amend, rewrite
  published history, or force-push without explicit prior maintainer approval
  for that exact operation.
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
- Do not create a commit until the focused work can stand alone and its
  applicable validation and local review have completed.
- A push, remote pull-request mutation, review comment, label change, or other
  remote repository write requires explicit authorization in the current human
  request. Authorization for one remote action does not imply another.

## Validation Expectations

Use the live repository scripts and run the smallest checks that exercise the
changed path. Do not invent commands or report an unexecuted check as passing.

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
git ls-files -z -- '*.js' '*.mjs' | xargs -0 -n1 node --check
npm run i18n:check
npm run notices:check
npm test
```

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
- Issue linkage does not prove mergeability. Validation, compatibility,
  privacy, CI, and review requirements still apply.

For security-sensitive work, use GitHub private vulnerability reporting, a
private security advisory, or another maintainer-approved private channel. If a
public reference is required, use a sanitized tracking Issue with no exploit
details, secrets, private endpoints, or affected-user data.

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

A passing local `codex-review` is mandatory before committing and before
pushing. It is a read-only reviewer; the implementing agent independently
verifies and resolves its findings.

Follow this sequence:

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

```markdown
Use the local `codex-review` skill in read-only review mode.

Review the current local branch and working tree against `<BASE_BRANCH>` for Issue `#<ISSUE_NUMBER>`.

## Goal and scope

- Intended change: `<FOCUSED_CHANGE_SUMMARY>`
- Linked Issue and acceptance criteria: `#<ISSUE_NUMBER>`
- Base branch: `<BASE_BRANCH>`
- Review the exact current local state, including committed changes since the base, staged changes, unstaged changes, and untracked task files intended for inclusion.
- Read the current `AGENTS.md` and apply only repository rules relevant to this change.

## Required inspection

1. Inspect `git status --short`, `git diff`, `git diff --cached`, and the diff and commits against `<BASE_BRANCH>`.
2. Read the complete current contents and surrounding execution paths of every changed file; do not review only isolated diff hunks.
3. Use current repository-relative file paths and current local file line numbers. Do not use stale GitHub PR line numbers, outdated remote diffs, or earlier review-thread positions.
4. Trace relevant inputs, state transitions, outputs, error paths, cancellation paths, permissions, compatibility behavior, tests, build scripts, and release packaging.
5. Check for functional regressions, data loss, authorization failures, unsafe rendering or input handling, WordPress/PHP compatibility problems, performance or reliability risks, missing runtime/release assets, invalid tests, unnecessary complexity, privacy leaks, secrets, local-path exposure, and unrelated scope changes.
6. Verify that tests actually exercise the changed behavior and cannot pass only because of broad mocks, skipped tooling, polluted state, or file-presence assertions.
7. Report only confirmed, actionable issues introduced or materially worsened by the current local change. Do not invent findings, request speculative refactors, or report personal style preferences.

## Finding format

For each independently fixable finding, provide:

- Current local file path and current local line number or execution path.
- What is wrong.
- A realistic trigger.
- Concrete user, security, compatibility, data, performance, test, build, or release impact.
- The smallest focused correction direction.
- Whether it blocks commit or push, with a factual reason.

## Safety and authority

- Do not modify files, stage changes, commit, push, create or close Issues or pull requests, merge, enable auto-merge, or delete branches.
- Do not request or reproduce secrets, credentials, cookies, private keys, personal data, private article content, absolute local paths, private endpoints, raw logs, HAR data, browser storage, or unnecessary screenshots.
- Treat existing code and passing tests as evidence, not proof. Clearly distinguish confirmed findings from questions or unverified assumptions.
- The implementing agent will independently verify and resolve confirmed findings.

## Verdict

Return exactly one final verdict:

- `BLOCK` when one or more confirmed merge-blocking findings remain, followed by the findings.
- `APPROVE` when no confirmed merge-blocking findings remain, followed by exactly: `No merge-blocking findings found in the current local branch.`
```

## Push, CI, and CodeRabbit Review Order

Follow this sequence for every pull request update:

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
    60–90 second intervals.
13. Independently verify every CodeRabbit finding and change the project only
    for a confirmed defect or human maintainer decision.
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
- classify a failure as flaky before inspecting evidence;
- reuse a green run, walkthrough, approval, or review from an earlier SHA;
- push empty commits, formatting churn, or unrelated edits to retrigger CI or a
  bot;
- ask CodeRabbit to edit, push, merge, close, change metadata, enable
  auto-merge, delete branches, or resolve threads.

A slow response is not a failed request. Retry once only when concrete evidence
shows the request failed, was not accepted, was cancelled, its stated
rate-limit window expired, or no acknowledgement appeared after a reasonable
wait. Before retrying, confirm the Head is unchanged, exact-Head CI is still
green, and no review is queued or in progress. Resend the full template and do
not repeatedly retry the same Head.

### Mandatory CodeRabbit First-Review Template

```markdown
@coderabbitai full review

Please perform a complete, read-only review of the current pull request head `<HEAD_SHA>` against `<BASE_BRANCH>`.

## Review identity

- Current head SHA: `<HEAD_SHA>`
- Base branch: `<BASE_BRANCH>`
- Linked Issue: `#<ISSUE_NUMBER>`
- Pull request scope: `<FOCUSED_CHANGE_SUMMARY>`
- Files or subsystems changed: `<CHANGED_PATHS_OR_SUBSYSTEMS>`

## Verified preconditions

- Local `codex-review` verdict for the exact committed and pushed diff: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
- Confirmed local findings resolved: `<RESOLVED_FINDINGS_OR_NONE>`
- Validation actually completed: `<COMMANDS_AND_RESULTS_ACTUALLY_RUN>`
- Required CI/check status for `<HEAD_SHA>`: `<GREEN_OR_INTENTIONALLY_SKIPPED_WITH_REASON>`
- CodeRabbit queue state for this exact SHA, verified immediately before posting: `<NONE_QUEUED_OR_IN_PROGRESS_CONFIRMED_AT_POST_TIME>`

## Required review

1. Read the linked Issue, pull request body, current root `AGENTS.md`, complete diff, changed-file context, and relevant surrounding execution paths.
2. Verify that the implementation satisfies the linked Issue and remains inside its declared scope.
3. Trace relevant inputs, state transitions, outputs, error and cancellation paths, permissions, compatibility behavior, tests, build scripts, generated files, and release packaging.
4. Review the areas actually affected by this change, including functional correctness, regressions, authorization, data integrity, privacy, unsafe rendering or input handling, supported WordPress/PHP versions, performance, reliability, test validity, dependencies, assets, and release completeness where applicable.
5. Re-check every unresolved or outdated review thread against `<HEAD_SHA>`; do not assume a finding still applies merely because it existed on an older SHA.
6. Report only confirmed, actionable problems introduced or materially worsened by this pull request. Do not invent findings, request speculative refactors, enforce personal style preferences, or fill a finding quota.
7. Treat confirmed data loss, authorization failures, secret or personal-data exposure, unsafe rendering, incompatible WordPress/PHP behavior, invalid migration or revision behavior, and broken release packages as merge-blocking.

## Finding requirements

For each independently fixable finding, include:

- Repository-relative file path and current line or execution path.
- What is wrong.
- A realistic trigger or reproduction path.
- Concrete user, security, compatibility, data, performance, test, build, or release impact.
- The smallest focused correction direction.
- Whether it blocks merge and the factual reason.

## Privacy and authority

- Use redacted values, synthetic examples, and privacy-safe behavioral evidence.
- Do not request, quote, or repeat credentials, tokens, cookies, private keys, private article content, personal data, absolute local paths, private endpoints, raw browser storage, HAR files, or unnecessary logs.
- Do not republish screenshots or attachments unless publication is necessary, authorized, and their content and embedded metadata have been inspected.
- Do not modify files, push commits, merge, close the pull request or linked Issue, alter PR metadata, enable auto-merge, delete branches, or resolve threads.

## Current-head verdict

End the review with exactly one of these verdicts for `<HEAD_SHA>`:

- `EASYMDE_CODERABBIT_REVIEW_VERDICT: APPROVE — no confirmed merge-blocking issue found for <HEAD_SHA>.`
- `EASYMDE_CODERABBIT_REVIEW_VERDICT: BLOCK — confirmed merge-blocking findings remain for <HEAD_SHA>.`

When blocking, list the confirmed findings before the final verdict. When no actionable finding remains, do not create suggestions merely to avoid approval.
```

### Mandatory CodeRabbit Re-Review Template

```markdown
@coderabbitai full review

Please perform a complete, read-only re-review of the current pull request head `<NEW_HEAD_SHA>` against `<BASE_BRANCH>`.

## Re-review identity

- Previous reviewed head SHA: `<PREVIOUS_HEAD_SHA>`
- Current head SHA: `<NEW_HEAD_SHA>`
- Base branch: `<BASE_BRANCH>`
- Linked Issue: `#<ISSUE_NUMBER>`
- Pull request scope: `<FOCUSED_CHANGE_SUMMARY>`

## Fix summary

- Confirmed findings addressed: `<FINDING_IDS_OR_CONCISE_SUMMARIES>`
- Focused corrections made: `<CORRECTIONS_AND_CHANGED_PATHS>`
- Findings rejected as invalid or stale, with evidence: `<REJECTED_FINDINGS_OR_NONE>`
- Remaining unresolved threads or questions: `<UNRESOLVED_ITEMS_OR_NONE>`

## Verified preconditions for the new SHA

- Local `codex-review` verdict for the exact new committed and pushed diff: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
- Regression and affected validation actually rerun: `<COMMANDS_AND_RESULTS_ACTUALLY_RUN>`
- Required CI/check status for `<NEW_HEAD_SHA>`: `<GREEN_OR_INTENTIONALLY_SKIPPED_WITH_REASON>`
- CodeRabbit queue state for `<NEW_HEAD_SHA>`, verified immediately before posting: `<NONE_QUEUED_OR_IN_PROGRESS_CONFIRMED_AT_POST_TIME>`

## Required re-review

1. Re-read the linked Issue, pull request body, current root `AGENTS.md`, full current diff, and relevant surrounding execution paths rather than reviewing only the last fix commit.
2. Verify each previously confirmed finding against `<NEW_HEAD_SHA>` and state whether the root cause is resolved.
3. Check whether the fixes introduced regressions, incomplete state transitions, weak tests, compatibility problems, privacy exposure, build or release omissions, or unrelated scope changes.
4. Re-check unresolved and outdated threads against the new code and current line positions.
5. Report only confirmed, actionable problems present in `<NEW_HEAD_SHA>`; do not repeat resolved or stale findings.
6. Apply the same finding quality, privacy, read-only authority, human-merge, and human-closure requirements as the first review.

## New-head verdict

End the re-review with exactly one of these verdicts for `<NEW_HEAD_SHA>`:

- `EASYMDE_CODERABBIT_REREVIEW_VERDICT: APPROVE — no confirmed merge-blocking issue found for <NEW_HEAD_SHA>.`
- `EASYMDE_CODERABBIT_REREVIEW_VERDICT: BLOCK — confirmed merge-blocking findings remain for <NEW_HEAD_SHA>.`

When blocking, list the confirmed current findings before the final verdict. An approval or walkthrough for `<PREVIOUS_HEAD_SHA>` must not be reused as the verdict for `<NEW_HEAD_SHA>`.
```

After posting either template, wait for acknowledgement or review activity.
Do not send another CodeRabbit mention merely because the response is slow.

## Issue Body Template

Use this structure for a new public Issue. Remove sections that genuinely do not
apply, but do not omit scope, acceptance criteria, or privacy review for
material work.

```markdown
## Summary

Describe the user-visible problem, repository maintenance need, or requested behavior in concrete terms.

## Current behavior

Explain what happens now and why it is incorrect, incomplete, unsafe, or difficult to maintain.
Do not paste private logs, credentials, local paths, private article content, or unnecessary machine details.

## Expected behavior

Describe the observable outcome that should be true after the Issue is resolved.

## Scope

- Included:
- Excluded:
- Compatibility constraints:

## Acceptance criteria

- [ ] The intended behavior is implemented or documented.
- [ ] Relevant failure and cancellation paths are covered.
- [ ] Existing supported behavior remains compatible.
- [ ] Appropriate tests or validation are added or updated.
- [ ] Public text and artifacts pass the privacy checks below.
- [ ] Closing this Issue still requires explicit human maintainer confirmation after the criteria are met.

## Validation or reproduction

Provide the smallest privacy-safe reproduction, test expectation, or verification plan.
Use redacted examples and behavior descriptions instead of raw sensitive evidence.

## Privacy and public artifact check

- [ ] No credentials, tokens, cookies, authorization headers, private keys, or local configuration values are included.
- [ ] No absolute local paths, usernames, home directories, temporary paths, screenshot paths, private endpoints, or internal service details are included unless they are an intentional non-sensitive public contract.
- [ ] No personal data, private article content, raw browser storage, HAR data, or unnecessary logs are included.
- [ ] Any attached image, archive, font, SVG, binary, or data URI has been checked for unnecessary EXIF, XMP, IPTC, geolocation, creator-tool, document-ID, instance-ID, or machine metadata.
- [ ] User-provided reference screenshots or files are not committed or republished unless publication is necessary, authorized, and privacy-reviewed.
```

## Pull Request Body Template

Use this structure for every pull request. Replace the first line with the
correct closing or non-closing reference.

```markdown
Closes #123

<!-- Use `Related to #123` instead when this PR does not fully resolve the Issue. -->

## Summary

- Describe the concrete changes.
- Explain the user, compatibility, security, maintenance, or release problem they solve.

## Scope and linked Issue

- Linked Issue: #123
- Confirm that this PR stays within the Issue scope.
- List intentionally deferred or excluded work.

## Human closure control

This pull request and its linked Issues must remain open until a human maintainer explicitly authorizes merge or closure. Green CI, bot approval, resolved threads, completed checklists, or inactivity are not closure authorization.

## Implementation notes

Describe important state transitions, WordPress integration points, compatibility boundaries, and failure behavior.
Do not include private implementation evidence or local environment details.

## Safety and compatibility

- Markdown source-of-truth impact:
- `post_content` compatibility impact:
- WordPress permissions, nonce, REST, save, revision, or publishing impact:
- Existing settings, themes, extension APIs, and migration impact:
- Runtime dependencies, assets, licenses, and release-package impact:

## Validation

List only checks actually performed, including commands and results where useful.
State unavailable or unverified checks honestly.

- [ ] Focused automated tests
- [ ] Relevant integration or browser checks
- [ ] PHP, Node, lint, i18n, build, or package checks as applicable
- [ ] Negative, cancellation, permission, and failure-path checks as applicable
- [ ] Local `codex-review` completed for the exact committed and pushed diff
- [ ] Every confirmed local review finding was resolved and affected validation was rerun
- [ ] Final local review verdict recorded without private local details
- [ ] CI status reviewed for the current head SHA
- [ ] Existing CodeRabbit request status checked before posting a new review command

## Privacy and public artifact review

- [ ] Reviewed the diff, commit messages, PR body, linked Issue, review replies, fixtures, and generated artifacts for private information.
- [ ] No secrets, credentials, cookies, private keys, personal data, private article content, local configuration, or unredacted sensitive values are included.
- [ ] No unnecessary absolute paths, usernames, home directories, localhost/private/staging endpoints, ports, logs, HAR files, browser storage, screenshot paths, or machine identifiers are included.
- [ ] No user-provided reference screenshot or file was committed or publicly reposted without necessity, authorization, and content/metadata inspection.
- [ ] New images, archives, fonts, SVGs, binaries, and embedded data were checked for unnecessary EXIF, XMP, IPTC, geolocation, creator-tool, document-ID, instance-ID, and similar metadata.
- [ ] Sensitive values in public descriptions are redacted rather than repeated.

## Remaining risks and follow-up

List known limitations, assumptions, deferred work, unresolved local or remote review findings, bot availability or waiting state, or checks that could not be run.
```

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
- Markdown, HTML, DOM, Custom CSS, media, extension, storage, and preview sinks
  preserve their declared trust boundary.
- Raw Markdown HTML and unsafe Custom CSS do not become executable output.
- `_easymde_markdown`, `post_content`, revisions, metadata-existence behavior,
  and public compatibility APIs remain consistent.
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

## Completion Report

Report:

1. What changed and why each changed file belongs to the task.
2. Compatibility, migration, security, privacy, dependency, build, and release
   impact.
3. Commands and checks actually run, with results and exact revision when
   relevant.
4. Local `codex-review` scope, exact-state verdict, confirmed findings fixed,
   and rejected findings with concise evidence.
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
