# Testing And Delivery

## Contents

- [Choose tests](#choose-tests)
- [Local commands](#local-commands)
- [Evidence](#evidence)
- [Release and completion](#release-and-completion)

## Choose tests

Choose the lowest reliable boundary:

- `domain`: pure rules and edge cases;
- `contracts`: PHP/TypeScript fixtures, schema/version, errors, safe values,
  and Manifest metadata;
- `integrations`: WordPress DOM/form, REST, Nonce, Lock, Media, Storage,
  Clipboard, mounting, failure, and teardown;
- `features`: Hooks, Controllers, Components, Focus, keyboard, and form use;
- `app`: Providers, Root activation, Error Boundaries, and teardown;
- E2E: real WordPress behavior with the installable ZIP; and
- release/source archive: required runtime files and source inclusion rules.

Import and execute the production module under test. Exercise controls through
roles, names, labels, and user actions; snapshots are supplemental. Use
semantic readiness rather than fixed sleeps. Keep fixtures synthetic and free
of credentials, article content, private URLs, and machine paths. Test stale
completion, cancellation, duplicate activation, error mapping, cleanup,
accessibility, and the real authoritative result.

## Local commands

Inspect `package.json` first, then run only commands applicable to the change.
Common gates are:

```bash
git diff --check
npm run assets:check
npm run frontend:check
npm run i18n:check
npm run notices:check
npm test
npm run build:release
npm run build:source-archives
```

Frontend checks include locked generated assets, lint, strict TypeScript,
Vitest, the test build contract, and read-only production comparisons. The
focused WeChat suites are:

```bash
npm run test:frontend -- frontend/src/integrations/browser/wechat/create-browser-wechat-clipboard.test.ts
npm run test:frontend -- frontend/src/features/wechat-export/wechat-export-session.test.ts
```

Use the exact PHP/WordPress, Plugin Check, clean install, and Chromium E2E
commands documented in `docs/TESTING_AND_RELEASE.md`. Do not claim those gates
without running them. If a command is unavailable or fails, inspect the real
step and report its cause; never label it flaky without evidence.

## Evidence

For a focused Feature, report:

```text
Changed contract and live owner:
Current guidance owner and routed references:
Tests and commands actually run:
Package/build/release impact:
Security/privacy evidence:
Review and CI evidence:
Unverified areas and remaining risks:
```

For owner removal, add the consumer inventory, characterization behavior,
zero-consumer/write-path proof, replacement owner, public compatibility result,
and protected-surface regression. For UI changes, add controlled reference
conditions, geometry/computed-style, interaction/accessibility, and temporary
artifact cleanup evidence from the UI reference.

## Release and completion

The installable plugin ZIP contains required compiled runtime, CSS, static
assets, Composer dependencies, licenses, translations, and notices; it excludes
frontend source, repository-only development files, tests, caches, private data,
and unrelated artifacts.
Source archives are a different product and may include intentionally tracked
`frontend/` source. Do not apply one allowlist to the other. Exact inclusion,
exclusion, build, and validation belong to the release document and scripts.

Before completion, confirm one owner per behavior, no public contract drift,
valid manifests and local asset URLs, no private React or remote executable,
clean teardown, honest failure states, focused package impact, and an exact
diff. Re-run affected checks after the final change. Public evidence must omit
credentials, Tokens, Nonces, Cookies, article content, raw server errors,
absolute paths, and unnecessary metadata.
