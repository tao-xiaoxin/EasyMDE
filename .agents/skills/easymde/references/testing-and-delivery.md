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

For Settings Center first-paint work, inspect the compositor boundary. The E2E
gate covers desktop/mobile viewport, cold/warm cache, normal/hard refresh, and
baseline/throttled CPU-plus-network profile, for 16 combinations. Capture CDP
screencast frames from navigation commit through semantic readiness, decode the
actual frame payload, and find the first nonblank frame before reading the
settled DOM. Only a contiguous leading prefix of blank frames may precede that
frame; if no nonblank frame exists, the case fails. From the first nonblank
frame through readiness, every frame must be nonblank and match the stable
Settings pixel fingerprint; any later blank or mismatch fails. Normal uses an
ordinary reload; hard uses CDP
`Page.reload({ ignoreCache: true })` immediately before every reload while
preserving the cache state established by the case setup. Match each frame to
the stable pre-navigation Settings pixel fingerprint, and
prove the same classifier rejects a real native wp-admin page capture. Accept a
no-frame reload only when the visible Settings pixels are retained exactly. Then
separately assert the dedicated document has
no ordinary wp-admin shell IDs. Block the Settings script, stylesheet, and
scripts through CSP to verify the accessible dedicated failure. The generated
case names are:

```text
desktop-cold-normal-baseline
desktop-cold-normal-throttled
desktop-cold-hard-baseline
desktop-cold-hard-throttled
desktop-warm-normal-baseline
desktop-warm-normal-throttled
desktop-warm-hard-baseline
desktop-warm-hard-throttled
mobile-cold-normal-baseline
mobile-cold-normal-throttled
mobile-cold-hard-baseline
mobile-cold-hard-throttled
mobile-warm-normal-baseline
mobile-warm-normal-throttled
mobile-warm-hard-baseline
mobile-warm-hard-throttled
```

With no `EASYMDE_FIRST_PAINT_CASE`, the test runs all 16 cases. When it is set,
the value must exactly match one generated case name; an empty or unknown value
fails before the browser starts and selects exactly one case. The strict
positive `EASYMDE_FIRST_PAINT_RUNS` override defaults to `1`. The stdout line
and JSON attachment intentionally expose only `caseName`, `iteration`,
`stableState`, and `durationMs` so sharded evidence can be audited without
including browser or page data. DOM mutation plus `requestAnimationFrame`, a
final screenshot, a body pseudo-element, broad Core selector hiding, and fixed
sleeps are not first-paint proof.

Run the default 16-case smoke and one filtered two-run smoke before a long
acceptance run:

```bash
# EASYMDE_FIRST_PAINT_RUNS defaults to 1 and runs all 16 cases.
EASYMDE_E2E_BASE_URL=<wordpress_test_url> \
EASYMDE_E2E_WP_PATH=<wordpress_test_path> \
EASYMDE_E2E_WP_CLI=<wp_cli_path> \
npm run test:e2e -- tests/e2e/settings-center.spec.mjs \
  -g "desktop/mobile, cold/warm, normal/hard, and baseline/throttled"

EASYMDE_FIRST_PAINT_RUNS=2 \
EASYMDE_FIRST_PAINT_CASE=desktop-cold-normal-baseline \
EASYMDE_E2E_BASE_URL=<wordpress_test_url> \
EASYMDE_E2E_WP_PATH=<wordpress_test_path> \
EASYMDE_E2E_WP_CLI=<wp_cli_path> \
npm run test:e2e -- tests/e2e/settings-center.spec.mjs \
  -g "desktop/mobile, cold/warm, normal/hard, and baseline/throttled"
```

For Issue #222 acceptance, run `EASYMDE_FIRST_PAINT_RUNS=50` once per case,
save each stdout/attachment log separately, and aggregate exactly 16 files,
800 evidence rows, 50 rows per case, and exactly the four public fields above.
Do not treat one unsharded 800-run process as equivalent evidence: each case
must be independently named and auditable.

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
