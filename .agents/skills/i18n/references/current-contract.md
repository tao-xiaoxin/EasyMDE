# EasyMDE i18n Current Contract

本文件是当前仓库 i18n owner、提取、catalog、Script Handle、loader/main、
扩展 API 和包证据的唯一事实来源。它描述 live code，不描述目标架构。
改代码后先重新核对本文件涉及的路径和产物；若事实变化，更新本文件，不在
入口 Skill 或迁移参考中复制同一份实现快照。

## Identity

- 插件 Text Domain 是 `easymde`，插件头的 Domain Path 是 `/languages`。
- 插件当前最低 WordPress 版本为 6.7，最低 PHP 版本为 7.4；这些值来自
  `easymde.php` 的插件头。
- 根 `package.json` 是唯一 npm project，提供 `i18n:make-pot`、
  `i18n:compile`、`i18n:check`，以及 frontend/build/release 检查。

## Source And Extraction

`scripts/i18n.mjs` 是仓库自有的 i18n pipeline：

- PHP source roots 是 `easymde.php`、`includes`、`src`、`templates`；
  source files 按稳定排序交给 `xgettext`。
- PHP keywords 覆盖普通、escaped、context、plural Gettext 调用，并包含
  `source_label:1`，用于可提取的默认扩展 Toolbar 文案。
- 当前 JavaScript/TypeScript source 只有
  `frontend/src/integrations/wordpress/i18n/create-wordpress-immersive-i18n-port.ts`。
  pipeline 用 `xgettext --language=JavaScript` 提取 `_n` 和 `translators:`
  注释。
- PHP 与该 TS source 的 POT body 由 `msgcat --force-po` 合并；source
  reference 的路径分隔符被规范为 `/`。
- 缺少 `xgettext`、需要合并时缺少 `msgcat`、命令报告 warning、没有 PHP
  source 或没有消息都会失败，不会静默生成空 catalog。

## Catalog And Compilation

当前维护的语言文件是：

- `languages/easymde.pot`
- `languages/easymde-zh_CN.po`
- `languages/easymde-zh_CN.mo`
- `languages/easymde-zh_CN-easymde-admin-editor-toolbar.json`

`compileMo()` 用 `msgfmt --check --check-header` 从维护的 PO 生成 MO。
`compileJsCatalog()` 直接读取同一个 PO 的 source entries 和 translation
entries，写出 WordPress Jed JSON；JSON 文件名固定为
`easymde-zh_CN-easymde-admin-editor-toolbar.json`，不是构建时人工维护的
临时文件。它包含 domain、locale、plural forms、translation revision date
和当前 TS source 的消息。

`checkI18n()` 要求四个文件存在，POT 必须由当前 source 重生成且字节一致，
PO header、完整覆盖、plural 数量、fuzzy/untranslated 状态、MO 字节和 JSON
字节都必须通过。维护的 `zh_CN` catalog 当前覆盖 PHP 消息以及四条沉浸式
计数消息：word、character、estimated reading time、revision。

## Runtime Owners

| Surface | Current owner | Runtime boundary |
| --- | --- | --- |
| PHP-rendered text and ordinary/immersive Editor Root browser text | PHP Gettext in `src/Admin/AdminAssets.php` | `AdminAssets::get_strings()` values are placed in the `EasyMDEEditorRootBootstrap` payload. |
| Settings Center browser text | PHP Gettext in `SettingsCenterStrings::get()` called by `src/Admin/SettingsPage.php` | `window.EasyMDESettingsCenterBootstrap.strings` is consumed by `frontend/src/entrypoints/settings-center.tsx` through the independent classic handle `easymde-admin-settings-center` and its `wp-element` dependency. |
| Immersive word, character, reading-time and revision counters | `createWordPressImmersiveI18nPort()` | `@wordpress/i18n` calls WordPress `wp.i18n` with domain `easymde`; raw counts choose plural and locale-formatted values fill placeholders. |
| Public article enhancement text | PHP Gettext in `src/Frontend/FrontendAssets.php` | `wp_localize_script('easymde-frontend', 'EasyMDEFrontendConfig', ...)` owns the `strings` map for the current singular EasyMDE post. |

The admin and public surfaces share the `easymde` domain but do not share a
message instance. A message remains with its current owner until a completed
transfer follows [owner-transfer.md](owner-transfer.md).

## Admin Loader And Main

The current admin browser path has two classic-script entries:

1. `frontend/src/entrypoints/admin-editor-loader.ts` is built under
   `assets/build/admin-editor-loader/` and uses the stable handle
   `easymde-admin-editor-toolbar`.
2. `frontend/src/entrypoints/admin-editor.tsx` is built under `assets/build/`
   and uses the same stable handle. The loader validates its serialized
   bootstrap, waits for the required editor DOM and WordPress runtime, loads the
   same-origin `mainScriptUrl`, then calls `EasyMDEAdminEditorStart`.

`src/Admin/AdminAssets.php` resolves both entries through
`ManifestAssetResolver`, enqueues the loader, and calls
`wp_set_script_translations( $handle, 'easymde', Asset::path( 'languages' ) )`.
The production metadata for both entries declares `wp-api-fetch`, `wp-element`,
`wp-hooks` and `wp-i18n`; the production editor build externalizes
`@wordpress/element` and `@wordpress/i18n` to WordPress `wp.element` and
`wp.i18n`.

The PHP serialized editor payload is passed through the loader as
`editorBootstrap`. When the DOM and main entry are ready, the loader exposes the
same payload as `window.EasyMDEEditorRootBootstrap` and passes it to the main
entry. The main entry mounts the one Editor Root and exposes
`EasyMDEAdminEditorStart`; it does not create a second translation or document
authority.

The active admin catalog therefore belongs to the classic handle
`easymde-admin-editor-toolbar`, but a static handle, registration call, or JSON
file is not proof that a browser visibly loaded a translated message.

## Public Frontend Bootstrap

`src/Frontend/FrontendAssets.php` only enters the public path for a singular
EasyMDE post. It resolves and enqueues the local frontend enhancement and
bootstrap entries, then localizes `easymde-frontend` with:

- `renderingFailed`
- `copyCode`
- `copied`
- `codeCopied`
- `codeCopyFailed`

`frontend/src/entrypoints/frontend-bootstrap.ts` and
`frontend/src/entrypoints/frontend-code-copy.ts` consume
`EasyMDEFrontendConfig.strings` and the adjacent feature configuration. The
public page remains PHP-rendered and receives no admin Editor Root catalog or
admin bootstrap state.

## Extension API

The public compatibility facade in `includes/class-easymde-plugin.php` exposes:

- `EasyMDE_Plugin::register_toolbar_button()` stores a command in
  `src/Support/ToolbarRegistry.php`. `get_commands_for_script()` applies the
  existing core `translate( $value, 'easymde' )` step to command `label` and
  `description`; browser consumers receive the resulting display values and do
  not translate them again. Built-in source labels use `source_label()` so the
  pipeline can extract them.
- `EasyMDE_Plugin::register_shortcode_helper()` stores a helper and
  `get_shortcode_helpers_for_script()` passes the registered configuration
  through without automatic core translation. Helper display values remain the
  extension's responsibility.

Command IDs, actions, shortcuts, configuration keys and other identifiers are
not display messages. The current contract has no extension text-domain
descriptor or mechanism to identify an already translated value. Changing
either API's translation behavior requires a separate compatibility decision.

## Package Evidence

`scripts/build-release.mjs` currently requires these language files in the
installable plugin package:

- `languages/easymde.pot`
- `languages/easymde-zh_CN.po`
- `languages/easymde-zh_CN.mo`
- `languages/easymde-zh_CN-easymde-admin-editor-toolbar.json`

The release builder rejects unexpected `.json` files under `languages/` and
requires valid Vite and WordPress manifest pairs for the production entries.
The manifests must agree on source entry, built file, `.asset.php` metadata,
stable handle, dependency list, and runtime resource list. Missing, malformed,
stale or unexpected production artifacts fail the release build.

The installable ZIP is assembled from runtime package paths and includes
`languages/`, compiled `assets/build/` output, Composer runtime dependencies,
licenses and notices. Development source, tests, caches and frontend build
configuration are outside that runtime package boundary. Source ZIP and
source tar.gz are separate archives created from the tracked Git tree by
`scripts/build-source-archives.mjs`; their source inclusion rules are not the
installable ZIP rules.

## Evidence Status

`npm run i18n:check` proves source extraction and catalog/MO/JSON consistency.
The WordPress CI job runs `scripts/verify-wordpress-i18n.php` against the
WordPress version downloaded by the WP-CLI default (the workflow does not pin a
`--version`) and verifies real `zh_CN` and `en_US` PHP Gettext/MO behavior after
locale reload.

Version-matched WordPress 6.7 runtime evidence for the relevant MO and JSON
claims is currently `unverified`. Real WordPress 6.7 non-English JSON
runtime-visible loading for the classic admin script is also `unverified`. The
existing evidence does not prove that a browser rendered a translated immersive
counter from the shipped JSON; static catalog presence, manifest registration,
`wp_set_script_translations()` return status, and package inclusion must not be
reported as that runtime proof. Any future claim must identify the installed
package, WordPress version, locale, actual loaded JSON, visible message, and
failure behavior without browser mocks or source-English substitution.
