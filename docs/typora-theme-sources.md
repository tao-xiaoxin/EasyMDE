# Typora Theme Sources

The built-in themes listed below are adapted into the EasyMDE article-theme
boundary. Their CSS is scoped to the rendered article root and does not change
the editor shell or shared code-frame ownership.

| EasyMDE ID | Typora file name (installed) | Upstream source revision | Selected variant | License / attribution |
| --- | --- | --- | --- | --- |
| `inkwell` | `墨砚-typora-theme-inkwell` (loader-safe alias for `墨砚（typora-theme-inkwell）`) | `toxic-19/typora-theme-inkwell@a7d1be224725744c78532c6009e6d6ba54d7c274` | `inkwell.css` | MIT, toxic-19; notice at `assets/themes/article/licenses/inkwell-LICENSE` |
| `inkwell-dark` | `墨砚深色-typora-theme-inkwell-dark` (loader-safe alias for `墨砚深色（typora-theme-inkwell-dark）`) | `toxic-19/typora-theme-inkwell@a7d1be224725744c78532c6009e6d6ba54d7c274` | `inkwell-dark.css` | MIT, toxic-19; notice at `assets/themes/article/licenses/inkwell-LICENSE` |
| `nocturne` | `夜曲-typora-nocturne-theme` (source mapping: `夜曲（typora-nocturne-theme）`) | `suhan42/typora-nocturne-theme@88fdf2221137e7431b865ddbaeb5f0e8b3cb9c8a` | independent EasyMDE recreation of the documented dark palette; native install is the upstream CSS with its remote font import removed | No repository license declaration found; upstream CSS is not copied |
| `animal-island` | `动物岛-typora-theme-animal-island` (source mapping: `动物岛（typora-theme-animal-island）`) | `YanyingWei1997/typora-theme-animal-island@c5b013430d68a883db4cc3b8a6235d4c02a0e57e` | `animal-island.css` (light) | MIT, YanyingWei; notice at `assets/themes/article/licenses/animal-island-LICENSE` |
| `phycat-mint` | `薄荷猫-typora-theme-phycat` (source mapping: `薄荷猫（typora-theme-phycat）`) | `sumruler/typora-theme-phycat@b49f1fc6b193e333a3ebb186bbf1ae7f8fc21778` | `phycat-mint.css`; the bundled `phycat/phycat.light.css` resource is installed beside it for the native theme | MIT, 徐继龙; notice at `assets/themes/article/licenses/phycat-LICENSE` |
| `onedark` | `one-dark-typora-onedark-theme` (source mapping: `OneDark（typora-onedark-theme）`) | `sweatran/typora-onedark-theme@c8e9eb0720d91ff63a23288f95b3358cd38387b2` | `theme/onedark.css` | GPL-3.0, sweatran; license and bundled font notices at `assets/themes/article/onedark/LICENSE` |
| `mdmdt` | `mdmdt-浅色-mdmdt` (source mapping: `Mdmdt 浅色（Mdmdt）`) | `cayxc/Mdmdt@a2f7d357144e38670727e876243a7fe58df2e848` | `mdmdt-light.css` | Apache-2.0, cayxc; notice at `assets/themes/article/licenses/mdmdt-LICENSE` |
| `dogschoice-pink` | `狗狗粉-dogs-choice` (source mapping: `狗狗粉（DogsChoice）`) | `dkheng/DogsChoice@0d686f858be543558364953f9e31d167d9af2263` | `dogs-qicaihong.css` pink/purple variant only | MIT, dkheng; notice at `assets/themes/article/licenses/dogschoice-LICENSE` |
| `bloom-petal` | `花瓣-typora-bloom-theme` (source mapping: `花瓣（typora-Bloom-theme）`) | `webkubor/typora-Bloom-theme@3abbeefbcca5a00ea36cc3677b1105de5e2c8f48` | built release `bloom-petal.css` (the `root-petal.css` + `base-light.css` light variant) | README declares MIT; source notice at `assets/themes/article/licenses/bloom-LICENSE` |
| `spring` | `春日-typora-spring-theme` (source mapping: `春日（typora-spring-theme）`) | `SprInec/typora-spring-theme@fb8bdaa6139d0649aba01aced459cd5b8b9d7227` | `spring.css` | MIT, SprInec; notice at `assets/themes/article/licenses/spring-LICENSE` |

Typora's macOS loader silently ignores CSS files whose names contain either
fullwidth or ASCII parentheses, even though it still lists the generated menu
label. All eight themes therefore use the loader-safe hyphen aliases shown
above. The original parenthesized candidates are retained as `.css.disabled`
files outside the scan so the source-to-install audit remains recoverable.

Remote Google Fonts and other network imports were removed from the runtime
CSS. Themes use the existing EasyMDE local/system font stack; OneDark retains
its small local WOFF files because the source CSS explicitly defines them.

Nocturne is intentionally an original implementation because copying a source
file without an explicit license would not be distributable. Its public
palette, layout, and component behavior are documented in the upstream README
and are used as the visual reference for the implementation.

The requested audit mapping remains `插件中文名（仓库名称）`; it is recorded in
the source-mapping column while the actual file basename is loader-safe.
Typora 1.10.8's macOS loader only applies basenames that contain no whitespace,
ASCII uppercase letters, or parentheses, even when a rejected file is still
listed in the menu. The native menu applies
`capitalizedString` and replaces hyphens with spaces, so its labels are the
loader's normalized form rather than the audit mapping. No Typora application
binary was modified. The previous `easymde-*.css` duplicate aliases remain as
`.css.disabled` files outside Typora's theme scan.
