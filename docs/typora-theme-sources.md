# Typora Theme Sources

The built-in themes listed below are adapted into the EasyMDE article-theme
boundary. Their CSS is scoped to the rendered article root and does not change
the editor shell or shared code-frame ownership.

| EasyMDE ID | Typora file name (installed) | Upstream source revision | Selected variant | License / attribution |
| --- | --- | --- | --- | --- |
| `inkwell` | `墨砚（typora-theme-inkwell）` | `toxic-19/typora-theme-inkwell@a7d1be224725744c78532c6009e6d6ba54d7c274` | `inkwell.css` | MIT, toxic-19; notice at `assets/themes/article/licenses/inkwell-LICENSE` |
| `nocturne` | `夜曲（typora-nocturne-theme）` | `suhan42/typora-nocturne-theme@88fdf2221137e7431b865ddbaeb5f0e8b3cb9c8a` | independent EasyMDE recreation of the documented dark palette | No repository license declaration found; upstream CSS is not copied |
| `animal-island` | `动物岛（typora-theme-animal-island）` | `YanyingWei1997/typora-theme-animal-island@c5b013430d68a883db4cc3b8a6235d4c02a0e57e` | `animal-island.css` (light) | MIT, YanyingWei; notice at `assets/themes/article/licenses/animal-island-LICENSE` |
| `phycat-mint` | `薄荷猫（typora-theme-phycat）` | `sumruler/typora-theme-phycat@b49f1fc6b193e333a3ebb186bbf1ae7f8fc21778` | `phycat-mint.css` + `phycat.light.css` | MIT, 徐继龙; notice at `assets/themes/article/licenses/phycat-LICENSE` |
| `onedark` | `one-dark（typora-onedark-theme）` | `sweatran/typora-onedark-theme@c8e9eb0720d91ff63a23288f95b3358cd38387b2` | `theme/onedark.css` | GPL-3.0, sweatran; license and bundled font notices at `assets/themes/article/onedark/LICENSE` |
| `mdmdt` | `mdmdt-浅色（mdmdt）` | `cayxc/Mdmdt@a2f7d357144e38670727e876243a7fe58df2e848` | `mdmdt-light.css` | Apache-2.0, cayxc; notice at `assets/themes/article/licenses/mdmdt-LICENSE` |
| `dogschoice-pink` | `狗狗粉（dogs-choice）` | `dkheng/DogsChoice@0d686f858be543558364953f9e31d167d9af2263` | `dogs-qicaihong.css` pink/purple variant only | MIT, dkheng; notice at `assets/themes/article/licenses/dogschoice-LICENSE` |
| `bloom-petal` | `花瓣（typora-bloom-theme）` | `webkubor/typora-Bloom-theme@3abbeefbcca5a00ea36cc3677b1105de5e2c8f48` | `root-petal.css` + `base-light.css` | README declares MIT; source notice at `assets/themes/article/licenses/bloom-LICENSE` |
| `spring` | `春日（typora-spring-theme）` | `SprInec/typora-spring-theme@fb8bdaa6139d0649aba01aced459cd5b8b9d7227` | `spring.css` | MIT, SprInec; notice at `assets/themes/article/licenses/spring-LICENSE` |

Remote Google Fonts and other network imports were removed from the runtime
CSS. Themes use the existing EasyMDE local/system font stack; OneDark retains
its small local WOFF files because the source CSS explicitly defines them.

Nocturne is intentionally an original implementation because copying a source
file without an explicit license would not be distributable. Its public
palette, layout, and component behavior are documented in the upstream README
and are used as the visual reference for the implementation.

The requested mapping remains `插件中文名（仓库名称）`; the upstream repository
spelling is recorded in the source-revision column. Typora 1.10.8's macOS
loader only accepts basenames matching `^[^\sA-Z]+\.css`, so ASCII uppercase
letters and spaces cannot be used in installed filenames. The four affected
names therefore use lower-case ASCII and hyphens (`one-dark`, `mdmdt-浅色`,
`dogs-choice`, and `typora-bloom-theme`) while preserving the repository mapping
above. The native menu applies `capitalizedString` and replaces hyphens with
spaces; the verified menu labels are `One Dark（Typora Onedark Theme）`,
`Mdmdt 浅色（Mdmdt）`, `狗狗粉（Dogs Choice）`, and
`花瓣（Typora Bloom Theme）`. No Typora application binary was modified. The
previous `easymde-*.css` duplicate aliases are retained as `.css.disabled`
files outside Typora's theme scan.
