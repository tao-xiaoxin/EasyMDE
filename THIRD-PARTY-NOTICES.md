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
| Inter Latin variable font | 4.1 | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2 | OFL-1.1 | Theme-isolated typography for the immersive writing workspace. | Yes, copied to assets/vendor/inter/inter-latin-variable.woff2 | assets/vendor/inter/LICENSE |
| JetBrains Mono Latin variable font | 2.304 | https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2 | OFL-1.1 | Theme-isolated source and statistics typography for the immersive writing workspace. | Yes, copied to assets/vendor/jetbrains-mono/jetbrains-mono-latin-variable.woff2 | assets/vendor/jetbrains-mono/LICENSE |
| Lora Latin variable font | Google Fonts v37 | https://fonts.gstatic.com/s/lora/v37/ | OFL-1.1 | Local serif typography for the immersive revision preview. | Yes, copied to assets/vendor/lora/lora-latin-variable.woff2, assets/vendor/lora/lora-latin-italic-variable.woff2 | assets/vendor/lora/LICENSE |
| KaTeX | 0.16.47 | https://registry.npmjs.org/katex/-/katex-0.16.47.tgz | MIT | Local math rendering script, stylesheet, and fonts. | Yes, copied to assets/vendor/katex/katex.min.js, assets/vendor/katex/katex.min.css, assets/vendor/katex/fonts/ | assets/vendor/katex/LICENSE |
| Mermaid | 10.9.6 | https://registry.npmjs.org/mermaid/-/mermaid-10.9.6.tgz | MIT | Local diagram rendering script. | Yes, copied to assets/vendor/mermaid/mermaid.min.js | assets/vendor/mermaid/LICENSE |
| Lucide icon paths | 0.487.0 | https://registry.npmjs.org/lucide-static/-/lucide-static-0.487.0.tgz | ISC | Locally embedded SVG path data for the isolated immersive workspace controls. | Yes, copied to assets/js/admin/immersive-workspace.js | assets/vendor/lucide/LICENSE |

Copied frontend assets are committed locally so the editor, preview, and frontend rendering do not require CDN access. Highlight.js, KaTeX, Mermaid, Inter, JetBrains Mono, Lora, and the embedded Lucide icon paths retain license files under `assets/vendor/`.

## Compiled Frontend Runtime Packages

| Name | Version | Source | License | Purpose | Bundled in ZIP | Notice location |
| --- | --- | --- | --- | --- | --- | --- |
| @codemirror/commands | 6.10.4 | https://registry.npmjs.org/@codemirror/commands/-/commands-6.10.4.tgz | MIT | CodeMirror editing commands, keymaps, and undo history. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @codemirror/language | 6.12.4 | https://registry.npmjs.org/@codemirror/language/-/language-6.12.4.tgz | MIT | Language-aware command infrastructure used by CodeMirror commands. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @codemirror/state | 6.7.1 | https://registry.npmjs.org/@codemirror/state/-/state-6.7.1.tgz | MIT | CodeMirror document, selection, transaction, and editor state. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @codemirror/view | 6.43.6 | https://registry.npmjs.org/@codemirror/view/-/view-6.43.6.tgz | MIT | CodeMirror browser editor view and input handling. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @lezer/common | 1.5.2 | https://registry.npmjs.org/@lezer/common/-/common-1.5.2.tgz | MIT | Shared syntax-tree infrastructure required by CodeMirror. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @lezer/highlight | 1.2.3 | https://registry.npmjs.org/@lezer/highlight/-/highlight-1.2.3.tgz | MIT | Highlighting infrastructure required by CodeMirror language support. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @lezer/lr | 1.4.10 | https://registry.npmjs.org/@lezer/lr/-/lr-1.4.10.tgz | MIT | LR parser infrastructure required by CodeMirror language support. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| @marijn/find-cluster-break | 1.0.3 | https://registry.npmjs.org/@marijn/find-cluster-break/-/find-cluster-break-1.0.3.tgz | MIT | Unicode grapheme boundary handling used by CodeMirror state. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| crelt | 1.0.7 | https://registry.npmjs.org/crelt/-/crelt-1.0.7.tgz | MIT | DOM element construction used by CodeMirror view. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| style-mod | 4.1.3 | https://registry.npmjs.org/style-mod/-/style-mod-4.1.3.tgz | MIT | Scoped runtime style modules used by CodeMirror view. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |
| w3c-keyname | 2.2.8 | https://registry.npmjs.org/w3c-keyname/-/w3c-keyname-2.2.8.tgz | MIT | Cross-browser keyboard key normalization used by CodeMirror view. | Yes, compiled into assets/build/ | THIRD-PARTY-NOTICES.md |

These packages are compiled into the production WordPress Editor entry. Their required license notices follow.

### @codemirror/commands

```text
MIT License

Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @codemirror/language

```text
MIT License

Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @codemirror/state

```text
MIT License

Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @codemirror/view

```text
MIT License

Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @lezer/common

```text
MIT License

Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @lezer/highlight

```text
MIT License

Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @lezer/lr

```text
MIT License

Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @marijn/find-cluster-break

```text
MIT License

Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### crelt

```text
Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### style-mod

```text
Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### w3c-keyname

```text
Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
