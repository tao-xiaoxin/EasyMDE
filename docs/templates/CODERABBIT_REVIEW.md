# CodeRabbit Review Templates

Use these reusable bodies with the [Push, CI, and CodeRabbit Review Order](../../CONTRIBUTING.md#push-ci-and-coderabbit-review-order) workflow.

## Mandatory CodeRabbit First-Review Template

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

- Local `codex-review` verdict for the exact outgoing diff reviewed before commit and push: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
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

## Mandatory CodeRabbit Re-Review Template

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
