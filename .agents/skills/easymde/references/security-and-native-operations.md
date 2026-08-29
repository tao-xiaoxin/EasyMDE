# Security And Native Operations

## Contents

- [Input and authorization](#input-and-authorization)
- [HTML, Markdown, and CSS](#html-markdown-and-css)
- [State-changing operations](#state-changing-operations)
- [Privacy and evidence](#privacy-and-evidence)

## Input and authorization

Use WordPress APIs for hooks, assets, metadata, capabilities, Nonces,
sanitization, escaping, REST, persistence, and user data. Apply `wp_unslash()`
before validating or sanitizing `$_POST` and `$_GET`. Validate exact type,
shape, range, enum, identity, and size where possible; sanitize only where
exact validation is impossible; escape for the actual output context.

Every protected operation has an action-specific Nonce and capability check. A
request naming a Post must verify
`current_user_can( 'edit_post', $post_id )`; a REST Route has its own
`permission_callback`. Authentication or a valid Nonce never replaces
authorization. Stable machine Error Codes and HTTP Status stay separate from
translated user messages, and raw server errors never reach the user.

Treat Markdown, Custom CSS, REST and Bootstrap values, extension descriptors,
AI output, Storage, Clipboard input, and browser messages as untrusted. Parse
external values at the boundary before mounting or executing an operation.

## HTML, Markdown, and CSS

`EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the
only production Markdown renderer. Raw Markdown HTML is disabled by default.
Sanitize final HTML once before it enters the branded Preview-owned Safe HTML
sink. Do not add a browser Markdown renderer, partial fallback, or second
trusted HTML sink. Bound Markdown, Mermaid, KaTeX, Highlight.js, TOC, and
post-response DOM work where the affected feature needs resource limits.

Custom CSS editing requires `unfiltered_html` and is scoped to the current
user's WordPress user-meta library. Use the maintained PHP CSS parser for
validation, nested at-rules, selector scoping, and safe output; regex is not a
parser or security boundary. Reject `@import`, `@charset`, `@font-face`,
`url(...)`, `expression(...)`, `behavior`, `-moz-binding`, and `javascript:`.
Preserve valid `@media`, `@supports`, `@keyframes`, CSS variables, and
percentage selectors. Retain a required legacy value when parsing is unsafe,
but never render unsafe output and never make React a trusted CSS authority.

REST controllers validate and sanitize every argument, bound Preview payloads,
return stable `WP_Error` codes with appropriate status, and do not expose raw
response HTML as a message. Keep the namespace `easymde/v1`.

## State-changing operations

Save, Publish, Upload, Restore, Settings, Custom CSS, and Clipboard operations
require an explicit owning event and never write from open, close, focus,
preview, cancellation, fallback, or teardown. A Promise is not success until
the real WordPress or browser owner succeeds. Protected Mutations do not retry
automatically except for the explicitly approved bounded Image Hosting
primary/backup contract; Verify Upload remains single-attempt.

The owner declares whether work is single-flight, ordered, or keyed-parallel;
binds completion to the current Site, User, Post, Root, Dialog, Feature, and
transaction identity; and handles duplicate activation, cancellation, stale
completion, network failure, lost authentication, capability, Nonce freshness,
or Post Lock truthfully. An Abort of browser observation does not prove that a
server Mutation was cancelled; reconcile with authoritative WordPress state.
Preserve unsaved content, the Dirty baseline, Local Draft recovery, and the
open native WordPress form when a protected operation becomes unavailable.

Clipboard is a compatibility export, not persistence or publication. It reads
only the current stable sanitized Preview and never writes Markdown,
`post_content`, metadata, revisions, or publication state. See the WeChat
reference for the activation and cleanup contract.

## Privacy and evidence

Never put article content, Custom CSS, prompts, model output, Tokens, Nonces,
Cookies, credentials, browser Storage, private endpoints, absolute local
paths, or raw server errors in logs, diagnostics, fixtures, public Issues,
reviews, screenshots, archives, or generated artifacts. Diagnostics contain
only the minimum useful Operation ID, stable Error Code, duration, Feature,
Owner State, and redacted context. Keep deterministic fixtures synthetic.

Check wrong User/Post, invalid or stale Nonce, missing capability, oversized
payload, invalid REST input, unsafe HTML/CSS, missing renderer, stale async
completion, network/partial completion, Clipboard rejection, and cleanup as
relevant. If evidence is unavailable, report `unverified` or `blocked`; never
manufacture a pass.
