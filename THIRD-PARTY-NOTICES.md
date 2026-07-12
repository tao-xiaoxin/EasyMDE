# Third-Party Notices

This file is generated from `composer.lock`, `package-lock.json`, and the EasyMDE copied runtime asset manifest. Run `npm run notices:write` after changing runtime dependencies or copied frontend assets, then verify with `npm run notices:check`.

Development-only tools such as PHPUnit, PHPCS, WPCS, Playwright, and Node package caches are not bundled in the release ZIP.

## Composer Runtime Packages

| Name | Version | Source | License | Purpose | Bundled in ZIP | Notice location |
| --- | --- | --- | --- | --- | --- | --- |
| dflydev/dot-access-data | v3.0.3 | https://github.com/dflydev/dflydev-dot-access-data.git | MIT | Nested configuration data access used by league/config. | Yes, under vendor/ | vendor/dflydev/dot-access-data |
| league/commonmark | 2.8.2 | https://github.com/thephpleague/commonmark.git | BSD-3-Clause | Production Markdown and GFM rendering. | Yes, under vendor/ | vendor/league/commonmark |
| league/config | v1.2.0 | https://github.com/thephpleague/config.git | BSD-3-Clause | Configuration support used by league/commonmark. | Yes, under vendor/ | vendor/league/config |
| nette/schema | v1.2.5 | https://github.com/nette/schema.git | BSD-3-Clause, GPL-2.0-only, GPL-3.0-only | Schema validation support used by league/config. | Yes, under vendor/ | vendor/nette/schema |
| nette/utils | v3.2.10 | https://github.com/nette/utils.git | BSD-3-Clause, GPL-2.0-only, GPL-3.0-only | Utility support used by nette/schema. | Yes, under vendor/ | vendor/nette/utils |
| psr/event-dispatcher | 1.0.0 | https://github.com/php-fig/event-dispatcher.git | MIT | Event dispatcher interfaces used by league/commonmark. | Yes, under vendor/ | vendor/psr/event-dispatcher |
| sabberworm/php-css-parser | v8.9.0 | https://github.com/MyIntervals/PHP-CSS-Parser.git | MIT | Custom CSS parsing, validation, and selector scoping. | Yes, under vendor/ | vendor/sabberworm/php-css-parser |
| symfony/deprecation-contracts | v2.5.4 | https://github.com/symfony/deprecation-contracts.git | MIT | Deprecation helper contracts used by runtime dependencies. | Yes, under vendor/ | vendor/symfony/deprecation-contracts |
| symfony/polyfill-php80 | v1.37.0 | https://github.com/symfony/polyfill-php80.git | MIT | PHP 8.0 compatibility polyfills required by runtime dependencies on PHP 7.4. | Yes, under vendor/ | vendor/symfony/polyfill-php80 |

Composer packages are bundled under `vendor/` in the release ZIP after `composer install --no-dev`. Their upstream license files and notices remain inside their package directories unless the upstream package does not ship a separate notice file.

## Copied Frontend Runtime Assets

| Name | Version | Source | License | Purpose | Bundled in ZIP | Notice location |
| --- | --- | --- | --- | --- | --- | --- |
| Highlight.js CDN assets | 11.11.1 | https://registry.npmjs.org/@highlightjs/cdn-assets/-/cdn-assets-11.11.1.tgz | BSD-3-Clause | Local syntax highlighting script and bundled Highlight.js code themes. | Yes, copied to assets/vendor/highlight/highlight.min.js, assets/vendor/highlight/styles/*.css | assets/vendor/highlight/LICENSE |
| KaTeX | 0.16.47 | https://registry.npmjs.org/katex/-/katex-0.16.47.tgz | MIT | Local math rendering script, stylesheet, and fonts. | Yes, copied to assets/vendor/katex/katex.min.js, assets/vendor/katex/katex.min.css, assets/vendor/katex/fonts/ | assets/vendor/katex/LICENSE |
| Mermaid | 10.9.6 | https://registry.npmjs.org/mermaid/-/mermaid-10.9.6.tgz | MIT | Local diagram rendering script. | Yes, copied to assets/vendor/mermaid/mermaid.min.js | assets/vendor/mermaid/LICENSE |
| Inter Latin variable font | 4.1 | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2 | OFL-1.1 | Theme-isolated typography for the immersive writing workspace. | Yes, copied to assets/vendor/inter/inter-latin-variable.woff2 | assets/vendor/inter/LICENSE |
| JetBrains Mono Latin variable font | 2.304 | https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2 | OFL-1.1 | Theme-isolated source and statistics typography for the immersive writing workspace. | Yes, copied to assets/vendor/jetbrains-mono/jetbrains-mono-latin-variable.woff2 | assets/vendor/jetbrains-mono/LICENSE |
| Lora Latin variable font | Google Fonts v37 | https://fonts.gstatic.com/s/lora/v37/ | OFL-1.1 | Local serif typography for the immersive revision preview. | Yes, copied to assets/vendor/lora/lora-latin-variable.woff2, assets/vendor/lora/lora-latin-italic-variable.woff2 | assets/vendor/lora/LICENSE |

Copied frontend assets are committed under `assets/vendor/` so the editor, preview, and frontend rendering do not require CDN access. Highlight.js, KaTeX, Mermaid, Inter, JetBrains Mono, and Lora license files are kept with their copied runtime assets.
