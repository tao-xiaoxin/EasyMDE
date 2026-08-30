# Dependencies, Assets, And Services

## Contents

- [Dependency gate](#dependency-gate)
- [Build and runtime assets](#build-and-runtime-assets)
- [Themes and fonts](#themes-and-fonts)
- [External services](#external-services)

## Dependency gate

Search the live project, WordPress packages, and existing Feature APIs before
adding a dependency. Choose an existing EasyMDE/WordPress capability first,
semantic HTML second, a maintained React 18-compatible headless primitive for
complex behavior third, and a focused project Component only when a verified
requirement remains. Evaluate ownership, accessibility, lifecycle, visual
fidelity, security, privacy, direct/transitive size, license, local delivery,
tests, update owner, and removal path. Do not add a package merely for a common
pattern or a smaller diff.

Use the root `package.json` and lockfile. Keep React, ReactDOM, declarations,
`@wordpress/element`, TypeScript, Vite, Node, and browser targets aligned with
the WordPress 6.7 React 18 runtime. A successful Vite build is not a
TypeScript check; retain `tsc --noEmit`. Do not bundle a private React runtime,
depend on HMR, or introduce a second frontend framework. A package change also
needs lockfile, notices, tests, release, and removal evidence.

## Build and runtime assets

Use Vite from the root npm project. Compile source under `frontend/` into
manifest-backed runtime under `assets/build/`. Externalize/map React,
ReactDOM, and WordPress Element to the supported WordPress runtime. Keep
handles stable, use a manifest-backed loader for hashed chunks, resolve from
the Plugin Asset Base, and verify subdirectory/Multisite URLs where relevant.

Redistributable JavaScript, CSS, fonts, icons, and similar static assets are
committed locally from locked npm or verified upstream sources. One project
asset inventory records source, destination, owner, purpose, license/notice,
release boundary, and managed directory. Preparation is explicit; CI, tests,
and release checks are read-only and fail on missing, changed, duplicate, or
unexpected files. Never add a CDN toggle, remote static fallback, mutable
remote executable, or silent host substitution.

Production output must not contain private React, source paths, source maps,
development server URLs, localhost, unapproved remote runtime assets, or
development code. Exact ZIP/source-archive inclusion is owned by
`docs/TESTING_AND_RELEASE.md` and the release scripts.

## Themes and fonts

Article and code themes use explicit registries and separate CSS owners. The
shared code frame owns frame geometry; article themes own article presentation;
code themes own token colors. Do not copy selectors between them, scan theme
directories at runtime, or let a surface-specific override become a second
palette owner. Each article theme has its own registered default code theme;
an explicit valid user choice remains authoritative and fallback selection does
not write on open.

User-visible fonts are canonical effective stacks. Reuse an existing ID when
family order and fallback semantics match; preserve historical IDs only as
compatibility aliases. Public pages load only assets required by current
content. Any intentional shared-frame or theme contract change requires a
focused task and real-browser regression across registered themes.

## External services

A genuine external service requires substantive remote functionality, one
owning Feature, explicit maintainer approval, official endpoint/terms/privacy
evidence, minimum data fields, authentication owner, consent/disclosure,
HTTPS/CORS/CSP behavior, timeout/cancellation/retry/failure contract,
subprocessors/telemetry review, release-channel classification, tests,
update owner, and removal plan. Hosting static files or an SDK is not a
service. Keep redistributable client code local.

Never send article content, prompts, model output, credentials, API keys,
Cookies, Nonces, private URLs, user identifiers, administrator data, local
paths, or unpublished-media information unless a focused authorized contract
requires that exact field. Keep credentials out of Bootstrap, HTML, logs,
archives, and ordinary settings responses. Reject unknown hosts, proxies,
remote configuration, tracking, and undisclosed subprocessors. Mutations do
not retry automatically outside the approved bounded contract.

The current approved Image Hosting providers are Cloudflare R2, Qiniu Kodo,
Alibaba Cloud OSS, and Tencent Cloud COS. The provider Adapter uses protected
same-origin WordPress routes; upload endpoints are validated HTTPS, while the
configured viewing domain supplies the one authoritative public image URL.
Primary/backup writes reuse one object key and the configured strict integer
retry bound `0..5`; attempts are serial, bounded, and fail the whole upload on
exhaustion without provider switching. Verify Upload is one attempt on the
selected provider, uses synthetic data, returns no article URL on failure, and
reveals no credentials except the explicit one-field administrator action with
capability, both Nonces, exact target, `no-store`, and transient memory.

Re-review service identity, endpoint, data, terms, retention, auth, consent,
failure, owning Feature, or distribution channel changes. Real-account checks
are authorized operator actions, never CI inputs.
