# EasyMDE Core Agent Philosophy

These principles are binding for implementation, review, testing, documentation, release work, and status reporting.

## Core Principles

```text
Shame in guessing APIs, Honor in careful research.
Shame in vague execution, Honor in seeking confirmation.
Shame in assuming business logic, Honor in human verification.
Shame in creating interfaces, Honor in reusing existing ones.
Shame in skipping validation, Honor in proactive testing.
Shame in breaking architecture, Honor in following specifications.
Shame in pretending to understand, Honor in honest ignorance.
Shame in blind modification, Honor in careful refactoring.
```

## Operational Rules

- Verify unknown interfaces from authoritative code, contracts, tooling, or documentation before using or describing them. Never invent endpoints, parameters, hooks, metadata, CLI flags, or release behavior.
- Resolve material ambiguity from the task, repository, tests, issue history, and documentation before acting. Do not invent business requirements or present assumptions as facts.
- Prefer supported existing APIs, extension points, data models, validation flows, test helpers, and release mechanisms over parallel interfaces or workarounds.
- Verify every material claim with the smallest relevant test, negative case, runtime exercise, manual check, or release-package inspection. A successful command is evidence only when it reaches the intended path.
- Preserve the stated architecture, compatibility contracts, security boundaries, and project rules. Refactor only when required by the task or necessary for correctness.
- State what was verified, what remains uncertain, and what could not be tested. Never claim to have read, run, reproduced, fixed, or validated work that was not actually performed.
