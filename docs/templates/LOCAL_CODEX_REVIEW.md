# Local Codex Review Template

Use this reusable body with the [Local Codex Review Before Commit and Push](../../CONTRIBUTING.md#local-codex-review-before-commit-and-push) workflow.

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
