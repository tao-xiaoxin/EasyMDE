---
name: easymde-i18n
description: Use this skill when adding, changing, migrating, reviewing, or validating EasyMDE user-facing strings, PHP Gettext calls, legacy browser bootstrap strings, React or TypeScript translations, locale-aware formatting, RTL behavior, translation catalogs, i18n build scripts, or release-package language assets.
---

# EasyMDE Internationalization Guide

EasyMDE uses WordPress internationalization. WordPress owns the active admin locale, locale data, text-domain loading, plural rules, date and number conventions, and translation delivery.

This Skill is a development contract. Its existence does not authorize runtime changes, new dependencies, language switching, catalog restructuring, or frontend implementation without a focused linked Issue.

## Authority and Evidence

Apply guidance in this order:

1. the current task, linked Issue, and explicit maintainer decisions;
2. root `AGENTS.md` and the live repository;
3. existing EasyMDE public and release contracts;
4. this Skill;
5. official documentation for the minimum supported WordPress version;
6. relevant React and TypeScript official documentation;
7. external project guidance such as react-admin;
8. blogs, search summaries, generated answers, and examples.

Use external projects for design ideas, not as project authority. When an external rule conflicts with WordPress or EasyMDE, keep the EasyMDE rule.

## Inspect Before Changing

Read the live files that own the affected path:

```text
AGENTS.md
easymde.php
src/Plugin.php
src/Admin/AdminAssets.php
scripts/i18n.mjs
package.json
languages/easymde.pot
languages/easymde-zh_CN.po
scripts/build-release.mjs
.github/workflows/ci.yml
relevant PHP, template, JavaScript, React, and test files
```

Before editing, answer:

- Which layer renders the message: PHP, legacy browser JavaScript, or React?
- Which layer owns translation of that message?
- Which WordPress script handle or PHP output loads it?
- Is the value translatable copy, user content, a stable identifier, or diagnostic data?
- Does it need context, placeholders, plural forms, date/number formatting, or RTL behavior?
- How will extraction, compilation, delivery, testing, and release packaging prove it works?

Do not infer the current pipeline from a future architecture document. Inspect the actual repository.

## Current EasyMDE Contract

Preserve these facts until a focused Issue changes them:

- the literal text domain is `easymde`;
- the plugin header declares `Domain Path: /languages`;
- PHP text-domain loading is deferred through the existing `init` path;
- `scripts/i18n.mjs` is the current authoritative generation, compilation, and validation pipeline;
- the root npm scripts are `i18n:make-pot`, `i18n:compile`, and `i18n:check`;
- the current extractor scans PHP under `easymde.php`, `includes`, `src`, and `templates`;
- the extractor also has project-specific keyword configuration that must remain covered by tests;
- the maintained `zh_CN` PO must cover every POT message without fuzzy or untranslated required entries;
- GNU gettext commands such as `xgettext` and `msgfmt` are explicit build prerequisites and missing tools must fail clearly;
- the current browser application receives PHP-translated strings through `EasyMDEConfig.strings`;
- `languages/easymde.pot`, `languages/easymde-zh_CN.po`, and `languages/easymde-zh_CN.mo` are required release files;
- the minimum supported WordPress version is 6.7;
- WordPress, not the browser, owns the admin locale;
- release ZIPs include runtime translations and exclude `.agents/`, tests, frontend source, caches, and development-only files.

A Skill must not describe a future extraction or JSON delivery path as already implemented.

## Translation Ownership

Every rendered message has one translation owner.

```text
PHP-rendered UI or PHP response copy
→ PHP Gettext with domain easymde

Existing legacy browser UI
→ PHP Gettext in AdminAssets or its owning PHP service
→ translated Bootstrap string
→ JavaScript renders the supplied value without translating it again

Future React or TypeScript UI
→ @wordpress/i18n in the owning source module
→ WordPress script translation delivery
→ React renders the translated value
```

Rules:

- Never translate the same value in PHP and JavaScript.
- A translated Bootstrap value is final presentation copy, not a message key.
- When React takes ownership, establish extraction and translation delivery before removing the Bootstrap owner.
- Remove an obsolete Bootstrap field when its last consumer is removed, unless a documented compatibility contract requires it.
- Do not keep two active translation paths as a fallback.
- Transport property names such as `previewError` are stable contract fields, not translation catalog keys.

## What To Learn From react-admin

Adopt these ideas where they fit EasyMDE:

- inventory every user-facing string systematically;
- use interpolation instead of concatenation;
- use real plural rules instead of singular/plural conditionals;
- scope copy to the feature that owns it;
- include notifications, errors, placeholders, tooltips, empty states, and screen-reader text;
- use locale-aware date and number formatting;
- validate catalogs and remove obsolete messages;
- make i18n checks part of PR completion.

Do not copy these react-admin conventions:

- Polyglot or an `i18nProvider`;
- `ra.*`, `resources.*`, or application key namespaces;
- `||||` plural syntax;
- react-admin language packs;
- browser-locale detection;
- a plugin language switcher;
- runtime locale switching;
- disabling automatic translation on the whole WordPress admin document;
- React Query, Router, Material UI, or other unrelated dependencies.

WordPress Gettext source strings are the catalog identity. EasyMDE does not need a parallel key-based message framework.

## WordPress Version Boundary

### Classic scripts on WordPress 6.7

For translatable JavaScript or React delivered as a classic WordPress script:

- declare the real `wp-i18n` dependency, or generate equivalent dependency metadata;
- externalize `@wordpress/i18n` to the WordPress runtime instead of bundling a private copy;
- register the script before calling `wp_set_script_translations()`;
- attach domain `easymde` and the approved languages path;
- verify generated Jed JSON files are available in the installable ZIP or through the supported WordPress.org language-pack path;
- verify every entry and lazy chunk containing messages is extracted and delivered.

Do not hard-code generated JSON filenames or hashes.

### Script Modules

WordPress 6.7 does not provide the public Script Module translation API introduced in WordPress 7.0.

While 6.7 remains the minimum:

- do not rely on `wp_set_script_module_translations()`;
- do not claim module translation loading is supported because current WordPress documentation describes a newer release;
- do not choose a Script Module-only translation path for a user-facing EasyMDE entry without a separately approved and tested 6.7-compatible solution;
- prefer the verified classic script translation path for translatable React entries.

If the minimum WordPress version is later raised, re-evaluate the official API in a separate Issue instead of prebuilding compatibility code now.

## PHP Gettext Rules

Use the narrowest correct WordPress function:

```text
__(), _e()                  simple copy
_x(), _ex()                 ambiguous copy requiring context
_n(), _nx()                 count-dependent copy
esc_html__(), esc_html_e()  plain HTML text output
esc_attr__(), esc_attr_e()  attribute output
sprintf(), printf()         placeholder substitution
```

Requirements:

- pass the literal domain `'easymde'` to every EasyMDE Gettext call;
- keep source messages as literal strings so extraction tools can find them;
- never use a variable, constant, dynamic expression, or concatenated value as a message ID;
- use a `translators:` comment immediately before a call with placeholders, unusual terminology, or non-obvious context;
- use numbered placeholders when translators may reorder values;
- use `_x()` or `_nx()` when an English word has more than one grammatical meaning;
- use `_n()` or `_nx()` for count-dependent copy, even when English appears to need only one plural form;
- format the displayed count separately with `number_format_i18n()` when appropriate;
- translate first and escape for the actual output context as late as possible;
- do not put unnecessary HTML inside a translatable message;
- do not translate an empty string;
- do not call translation functions before WordPress reaches the approved loading hook;
- do not place translated values in file-scope initialization, static property initialization, or constructors that can run before `init`;
- preserve WordPress 6.7 just-in-time loading behavior and treat early-translation warnings as defects.

Example:

```php
$message = sprintf(
    /* translators: %1$s: formatted revision count. */
    _n( '%1$s revision', '%1$s revisions', $count, 'easymde' ),
    number_format_i18n( $count )
);
```

## React and TypeScript Rules

When a focused frontend task has implemented extraction and delivery, use the WordPress runtime:

```ts
import { __, _n, _x, sprintf } from '@wordpress/i18n';

const label = __( 'Live preview', 'easymde' );
const title = _x( 'Preview', 'editor view mode', 'easymde' );
const countLabel = sprintf(
  _n( '%d revision', '%d revisions', count, 'easymde' ),
  count,
);
```

Rules:

- message IDs and contexts must be literals;
- do not use template literals or string concatenation to create translatable sentences;
- do not create a custom React i18n Provider for the default WordPress locale;
- direct `@wordpress/i18n` imports are sufficient unless a focused task proves a custom i18n instance is necessary;
- do not add an English message object or typed key catalog alongside Gettext;
- do not grow new bulk `EasyMDEConfig.strings` maps after the React translation pipeline is available; use them only for documented legacy ownership;
- do not use inline English fallback options that hide missing extraction or JSON delivery;
- React escapes text by default, but translations must not be injected through `dangerouslySetInnerHTML`;
- if markup is required, compose translated text with React elements instead of translating arbitrary HTML;
- do not use translated text as a React key, DOM ID, CSS selector, storage key, command ID, or control-flow discriminator.

A frontend source file with user-facing copy is incomplete until the extraction pipeline scans it and the release path delivers its translations.

## String Design

Write source English for translators, not only for current UI screenshots.

- Use complete phrases or sentences.
- Keep punctuation inside the translatable message when it belongs to the sentence.
- Avoid slang, unexplained abbreviations, and culture-specific jokes.
- Avoid leading or trailing whitespace.
- Do not split a sentence into independently translated fragments.
- Use placeholders for dynamic values and allow reordering.
- Keep the same source wording for the same product concept unless context genuinely differs.
- Add context instead of inventing slightly different English strings to disambiguate meaning.
- Assume translations can be substantially longer than English.
- Do not encode layout constraints into message wording.
- Do not use capitalization transforms to manufacture labels; translate the intended form.
- Keep brand and technical names such as EasyMDE, WordPress, Markdown, Mermaid, KaTeX, and Highlight.js unchanged unless an official localized form exists.

## Systematic String Inventory

When internationalizing a PHP template, legacy script, or React feature, inspect:

- visible text nodes;
- headings and button labels;
- labels, legends, descriptions, and help text;
- placeholders;
- tooltips and titles;
- empty, loading, success, warning, conflict, and error states;
- confirmation and destructive-action copy;
- notifications and status messages;
- screen-reader-only text and ARIA labels;
- keyboard shortcut descriptions;
- conditional strings and ternaries;
- template literals and concatenated sentences;
- REST or PHP user-facing error wrappers;
- AI, upload, media, revision, publish, settings, and recovery states.

Do not translate a string merely because it is written in English. Classify it first.

## Values That Must Not Be Translated

Do not send these through EasyMDE Gettext:

- post titles, Markdown, excerpts, taxonomy term names, tags, filenames, URLs, email addresses, or other user content;
- REST routes, request fields, response keys, schema versions, nonces, capability names, post meta keys, option names, cache keys, and storage keys;
- script handles, module IDs, command IDs, feature IDs, CSS classes, selectors, HTML IDs, and data attributes;
- log codes, telemetry-free diagnostic identifiers, exception class names, and machine-readable errors;
- Markdown syntax, source code, shell commands, JSON, CSS, and regular expressions;
- provider/model identifiers or configuration values;
- extension-supplied labels that the extension has already localized.

Translate a human-facing explanation around technical data, not the data itself.

## Extension and Dynamic Copy

EasyMDE public registries may receive labels and descriptions from other plugins.

- Built-in EasyMDE copy uses domain `easymde`.
- An extension owns localization of its own messages and should use its own text domain before registration.
- EasyMDE must not pass an extension-provided translated label back through its own Gettext domain.
- User-configured labels and stored content remain user data.
- Dynamic server error messages may already be localized by WordPress; translate the stable EasyMDE wrapper, not the message again.
- Extension identifiers remain stable and untranslated.

## Locale, Direction, Dates, and Numbers

- Use the WordPress current admin/user locale; do not choose locale from `navigator.language`.
- Do not add a plugin language switcher without a separate product requirement.
- Do not persist a duplicate EasyMDE locale preference.
- Use WordPress locale data for plural rules and direction.
- Use `is_rtl()` in PHP or `isRTL()` from `@wordpress/i18n`; do not infer RTL from a hand-maintained language list.
- Use logical CSS properties and test RTL; do not reverse business data or editor content.
- Use WordPress site timezone for scheduling and post-time semantics.
- Prefer `wp_date()`, `human_time_diff()`, `number_format_i18n()`, or corresponding WordPress JavaScript date utilities.
- Do not rely on browser-default `toLocaleString()` for authoritative WordPress dates or numbers.
- If JavaScript needs locale or timezone configuration, receive validated WordPress settings through the owning Bootstrap contract rather than recomputing them.

## Accessibility Copy

Accessibility text is product copy and must follow the same translation pipeline.

Include:

- accessible names for icon-only controls;
- form labels and error associations;
- dialog titles, descriptions, and close labels;
- status and alert messages;
- loading and progress descriptions;
- shortcut descriptions;
- screen-reader-only instructions;
- alternative text when an image conveys meaning.

Do not use machine identifiers or untranslated English as an ARIA label. Do not announce every keystroke or high-frequency preview update. Translate the message before passing it to the existing accessibility announcement path.

## Errors and Diagnostics

Separate user copy from machine diagnostics.

```text
stable error code       not translated
HTTP status             not translated
field or operation ID   not translated
user-facing summary     translated at presentation owner
developer context       not translated and must omit private content
```

Do not branch on translated text. Do not log translated article content, prompts, custom CSS, nonces, tokens, or credentials.

## Catalog and Build Workflow

The existing pipeline is authoritative. Extend it rather than creating a parallel translation system.

### Current PHP workflow

```bash
npm run i18n:make-pot
npm run i18n:compile
npm run i18n:check
```

Rules:

- do not hand-edit generated POT or MO output as the only change;
- update PO translations intentionally and remove fuzzy or missing entries;
- keep translator comments, contexts, and existing custom extraction keywords stable;
- add a custom extraction keyword only with a real owning helper and focused tests;
- preserve deterministic generation;
- keep catalog headers, text domain, version, encoding, and plural metadata valid;
- do not claim catalogs are current until `i18n:check` passes.

### Future TypeScript workflow

Before adding translatable TypeScript or TSX:

1. extend the authoritative pipeline to scan the declared frontend source roots;
2. prove PHP and TypeScript messages merge into one domain without loss or duplicate ownership;
3. generate WordPress-compatible JavaScript translation JSON using an approved deterministic tool;
4. load translations for every production entry that contains messages;
5. include required JSON in release validation;
6. test source-English fallback and a non-English locale from an installable ZIP;
7. ensure lazy-loaded code does not lose translations.

Do not add a second uncoordinated POT generator or a hand-maintained JavaScript catalog.

## Migrating Bootstrap Strings to React

Use one focused migration unit at a time:

1. inventory the current PHP field and every JavaScript consumer;
2. record the source English, context, placeholders, and accessibility use;
3. implement TypeScript extraction and script translation delivery;
4. add or update tests under a non-English WordPress locale;
5. switch the React owner to `@wordpress/i18n`;
6. remove the old Bootstrap field and legacy consumer in the same unit when safe;
7. regenerate and validate catalogs;
8. inspect the release ZIP;
9. verify no second translation owner remains.

Do not translate a Bootstrap string again in React during an intermediate phase.

## Testing

Choose checks based on the changed path.

### Static and catalog checks

- every EasyMDE Gettext call uses literal domain `easymde`;
- message IDs and contexts are literals;
- placeholder comments are present and correct;
- no sentence concatenation or manual plural branching was introduced;
- extraction includes every changed PHP, JavaScript, TypeScript, or TSX file;
- POT, PO, MO, and required JSON assets are current;
- no fuzzy, missing, malformed, or obsolete required translation remains;
- source and generated files have deterministic output.

### Runtime checks

- English source fallback remains usable;
- `zh_CN` or another maintained non-English locale loads in the WordPress admin;
- ambiguous messages use the expected context;
- singular and plural forms render correctly;
- numbered placeholders can reorder safely;
- RTL direction, focus order, icons, split panes, dialogs, and toolbar layout remain usable;
- long translations do not hide critical actions;
- status messages and ARIA labels are translated;
- dates use WordPress locale and site timezone;
- translated legacy Bootstrap copy is not translated twice;
- React script translations load before the entry renders;
- lazy code paths receive locale data;
- extension-provided and user-generated values remain unchanged.

### Release checks

- install and test the generated plugin ZIP;
- required POT, PO, MO, and implemented JSON files are present;
- source catalogs and development tooling are included only when release policy requires them;
- no frontend source, tests, cache, temporary extraction output, or local path enters the ZIP;
- the installed plugin works without a remote translation runtime.

Never claim a locale, browser, RTL, extraction, or release check that was not actually run.

## Prohibited Patterns

Do not introduce:

- a parallel i18n framework or provider;
- browser-locale detection as EasyMDE authority;
- a plugin language switcher without a product Issue;
- dynamic message IDs;
- translated control-flow keys;
- sentence concatenation;
- manual two-form plural logic;
- double translation across PHP and React;
- translatable user content or identifiers;
- arbitrary HTML in translations;
- automatic machine translation in build or runtime;
- a Script Module translation API unavailable on WordPress 6.7;
- a second POT or catalog pipeline without replacing the existing owner explicitly;
- silent fallback that hides missing extraction or missing release assets;
- speculative locale directories, language packs, abstractions, or dependencies.

## Completion Gate

Before completing an i18n change:

1. identify the single translation owner for every changed message;
2. confirm the locale, timezone, direction, and formatting authority;
3. confirm no user data or stable identifier was translated;
4. confirm context, placeholders, plural forms, escaping, and accessibility copy;
5. confirm extraction scans the changed source type;
6. confirm the correct WordPress script dependency and translation loader;
7. confirm current catalogs and generated runtime files;
8. run the relevant i18n, Node, PHP, browser, accessibility, and release checks;
9. inspect the exact diff and installable ZIP;
10. report what was verified, what was not verified, and any remaining risk.

## Official References

Use the version-appropriate official source before external examples:

```text
https://developer.wordpress.org/plugins/internationalization/
https://developer.wordpress.org/plugins/internationalization/how-to-internationalize-your-plugin/
https://developer.wordpress.org/apis/internationalization/
https://developer.wordpress.org/block-editor/reference-guides/packages/packages-i18n/
https://developer.wordpress.org/block-editor/reference-guides/packages/packages-date/
https://developer.wordpress.org/reference/functions/wp_set_script_translations/
https://make.wordpress.org/core/2024/10/21/i18n-improvements-6-7/
```

React-admin reference material is useful for inventory and message-design discipline, but its provider, namespaces, plural syntax, language packs, browser-locale selection, and runtime switching are not EasyMDE architecture.
