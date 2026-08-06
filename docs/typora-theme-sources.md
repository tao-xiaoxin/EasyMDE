# Typora Theme Sources

The built-in themes listed below are adapted into the EasyMDE article-theme
boundary. Their CSS is scoped to the rendered article root and does not change
the editor shell or shared code-frame ownership.

| EasyMDE ID | Typora file name (installed) | Upstream source revision | Selected variant | License / attribution |
| --- | --- | --- | --- | --- |
| `inkwell` | `墨砚-typora-theme-inkwell` | `toxic-19/typora-theme-inkwell@a7d1be224725744c78532c6009e6d6ba54d7c274` | `inkwell.css` | MIT, toxic-19; notice at `assets/themes/article/licenses/inkwell-LICENSE` |
| `animal-island` | `动物岛-typora-theme-animal-island` | `YanyingWei1997/typora-theme-animal-island@c5b013430d68a883db4cc3b8a6235d4c02a0e57e` | `animal-island.css` (light) | MIT, YanyingWei; notice at `assets/themes/article/licenses/animal-island-LICENSE` |
| `phycat-mint` | `薄荷猫-typora-theme-phycat` | `sumruler/typora-theme-phycat@b49f1fc6b193e333a3ebb186bbf1ae7f8fc21778` | `phycat-mint.css`; the bundled `phycat/phycat.light.css` resource is installed beside it for the native theme | MIT, 徐继龙; notice at `assets/themes/article/licenses/phycat-LICENSE` |
| `mdmdt` | `mdmdt-浅色-mdmdt` | `cayxc/Mdmdt@a2f7d357144e38670727e876243a7fe58df2e848` | `mdmdt-light.css` | Apache-2.0, cayxc; notice at `assets/themes/article/licenses/mdmdt-LICENSE` |
| `dogschoice-pink` | `狗狗粉-dogs-choice` | `dkheng/DogsChoice@0d686f858be543558364953f9e31d167d9af2263` | `dogs-qicaihong.css`（上游“七彩虹”粉/紫配色） only | MIT, dkheng; notice at `assets/themes/article/licenses/dogschoice-LICENSE` |
| `bloom-petal` | `花瓣-typora-bloom-theme` | `webkubor/typora-Bloom-theme@3abbeefbcca5a00ea36cc3677b1105de5e2c8f48` | built release `bloom-petal.css` (the `root-petal.css` + `base-light.css` light variant) | README declares MIT; source notice at `assets/themes/article/licenses/bloom-LICENSE` |
| `spring` | `春日-typora-spring-theme` | `SprInec/typora-spring-theme@fb8bdaa6139d0649aba01aced459cd5b8b9d7227` | `spring.css` | MIT, SprInec; notice at `assets/themes/article/licenses/spring-LICENSE` |

## Complete variant matrix

The first table keeps the repository-level source and license audit. This
matrix is the complete selectable inventory of the retained light and named
color variants. Dark, night, automatic, and other variants explicitly removed
from the product inventory are excluded. EasyMDE article-theme labels are
Chinese-only; repository names remain in the repository column for
auditability. Typora filenames are loader-safe aliases; the native loader
replaces hyphens with spaces and title-cases the repository part.

| Repository | EasyMDE IDs and audit labels | Upstream variant files | Installed Typora files |
| --- | --- | --- | --- |
| `toxic-19/typora-theme-inkwell` | `inkwell` / `墨砚` | `inkwell.css` | `墨砚-typora-theme-inkwell.css` |
| `YanyingWei1997/typora-theme-animal-island` | `animal-island` / `动物岛` | `animal-island.css` | `动物岛-typora-theme-animal-island.css` |
| `sumruler/typora-theme-phycat` | `phycat-cherry` / `樱桃猫`; `phycat-caramel` / `焦糖猫`; `phycat-forest` / `森林猫`; `phycat-mint` / `薄荷猫`; `phycat-sky` / `天蓝猫`; `phycat-prussian` / `普鲁士猫`; `phycat-sakura` / `樱花猫`; `phycat-mauve` / `淡紫猫` | `phycat-{cherry,caramel,forest,mint,sky,prussian,sakura,mauve}.css` | `樱桃猫-typora-theme-phycat.css`; `焦糖猫-typora-theme-phycat.css`; `森林猫-typora-theme-phycat.css`; `薄荷猫-typora-theme-phycat.css`; `天蓝猫-typora-theme-phycat.css`; `普鲁士猫-typora-theme-phycat.css`; `樱花猫-typora-theme-phycat.css`; `淡紫猫-typora-theme-phycat.css` |
| `cayxc/Mdmdt` | `mdmdt` / `Mdmdt 浅色` | `mdmdt-light.css` | `mdmdt-浅色-mdmdt.css` |
| `dkheng/DogsChoice` | `dogschoice-pink` / `狗狗粉` | `dogs-qicaihong.css` (上游“七彩虹” pink only; `dogs-jidilan.css` and `dogs-yuanshanlv.css` intentionally excluded) | `狗狗粉-dogs-choice.css` (preserved native qicaihong alias) |
| `webkubor/typora-Bloom-theme` | `bloom-petal` / `花瓣`; `bloom-mist` / `雾蓝`; `bloom-verdant` / `草木`; `bloom-stone` / `暖石`; `bloom-wheat` / `麦穗`; `bloom-ink` / `水墨`; `bloom-amber` / `琥珀`; `bloom-lapis` / `青金`; `bloom-ripple` / `涟漪`; `bloom-cinnabar` / `丹红`; `bloom-sage` / `鼠尾草`; `bloom-spring` / `紫语` | `dist/bloom-{petal,mist,verdant,stone,wheat,ink,amber,lapis,ripple,cinnabar,sage,spring}.css` | Matching Chinese-prefix loader-safe light-theme files |
| `SprInec/typora-spring-theme` | `spring` / `春日` | `spring.css` (single light palette) | `春日-typora-spring-theme.css` |

Typora's macOS loader silently ignores CSS files whose names contain either
fullwidth or ASCII parentheses, even though it still lists the generated menu
label. All eight themes therefore use the loader-safe hyphen aliases shown
above. The original parenthesized candidates are retained as `.css.disabled`
files outside the scan so the source-to-install audit remains recoverable.

Remote Google Fonts and other network imports were removed from the runtime
CSS. Themes use the existing EasyMDE local/system font stack.

The repository mapping remains in the source and repository columns while the
EasyMDE menu uses Chinese-only article-theme labels.

## Code-theme associations

The article and code menus are separate. The 25 active Typora-derived article
variants use 18 source-backed code palettes registered in `CodeThemeRegistry`.
The eight retained light Phycat wrappers intentionally share one `phycat-code`
entry because their native fenced CodeMirror palette is identical; their
article-specific inline-code colors remain article-owned. This avoids adding
duplicate code styles and duplicate menu entries. The code IDs point to the
single owned adapter `assets/themes/code/typora-derived.css`, whose scoped
blocks are checked against `docs/typora-code-palette-sources.json`. The shared
Mac frame still comes exclusively from `assets/css/frontend/code-frame.css`.

| Article ID | Default code ID | Palette source |
| --- | --- | --- |
| `inkwell` | `inkwell-code` | Inkwell light semantic colors |
| `animal-island` | `animal-island-code` | Animal Island light CodeMirror tokens |
| `phycat-*` (8 variants) | `phycat-code` | Shared Phycat light CodeMirror fenced palette; wrapper inline colors stay with the article theme |
| `mdmdt` | `mdmdt-code` | Mdmdt light CodeMirror tokens |
| `dogschoice-pink` | `dogschoice-pink-code` | DogsChoice 七彩虹 pink code-block variables |
| `bloom-*` (12 variants) | matching `bloom-*-code` | Bloom light syntax variables |
| `spring` | `spring-code` | Spring light CodeMirror tokens |

An explicit user-selected code theme remains authoritative when the article
theme changes; automatic association only applies while the code choice is not
explicit. No code-theme selector adds font, spacing, overflow, or frame
geometry rules.
Typora 1.10.8's macOS loader only applies basenames that contain no whitespace,
ASCII uppercase letters, or parentheses, even when a rejected file is still
listed in the menu. The native menu applies
`capitalizedString` and replaces hyphens with spaces, so its labels are the
loader's normalized form rather than the audit mapping. No Typora application
binary was modified. The previous `easymde-*.css` duplicate aliases remain as
`.css.disabled` files outside Typora's theme scan.
