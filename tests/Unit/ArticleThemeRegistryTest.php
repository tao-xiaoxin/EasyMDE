<?php

use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class ArticleThemeRegistryTest extends WP_UnitTestCase
{
    public function test_qingbi_liujin_theme_is_registered_with_asset_and_class()
    {
        $registry = new ArticleThemeRegistry();
        $theme = $registry->get('qingbi-liujin');

        $this->assertSame('qingbi-liujin', $theme['id']);
        $this->assertSame('Qingbi Liujin', $theme['label']);
        $this->assertSame('assets/themes/article/qingbi-liujin.css', $theme['asset_path']);
        $this->assertSame('easymde-markdown-theme-qingbi-liujin', $theme['class_name']);
        $this->assertSame('qingbi-liujin', $registry->sanitize_id('qingbi-liujin'));
    }

    public function test_qinghe_zhusha_theme_is_registered_with_asset_and_class()
    {
        $registry = new ArticleThemeRegistry();
        $theme = $registry->get('qinghe-zhusha');

        $this->assertSame('qinghe-zhusha', $theme['id']);
        $this->assertSame('Qinghe Zhusha', $theme['label']);
        $this->assertSame('assets/themes/article/qinghe-zhusha.css', $theme['asset_path']);
        $this->assertSame('easymde-markdown-theme-qinghe-zhusha', $theme['class_name']);
        $this->assertSame('qinghe-zhusha', $registry->sanitize_id('qinghe-zhusha'));
    }

    public function test_crimson_focus_is_added_without_replacing_red_crimson()
    {
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $this->assertArrayHasKey('red-crimson', $themes);
        $this->assertSame('assets/themes/article/red-crimson.css', $themes['red-crimson']['assetPath']);
        $this->assertArrayHasKey('crimson-focus', $themes);
        $this->assertSame('Crimson focus', $themes['crimson-focus']['label']);
        $this->assertSame(
            'assets/themes/article/crimson-focus.css',
            $themes['crimson-focus']['assetPath']
        );
        $this->assertSame('easymde-markdown-theme-crimson-focus', $themes['crimson-focus']['className']);
        $this->assertSame('atom-one-dark', $themes['crimson-focus']['defaultCodeTheme']);
        $this->assertTrue($themes['crimson-focus']['usesThemeFontFamily']);
        $this->assertArrayNotHasKey('usesThemeFontFamily', $themes['default']);
        $this->assertSame(
            array(
                'customFont'  => 'none',
                'windowsFont' => 'no-windows-font',
                'appleFont'   => 'no-apple-font',
                'serifFont'   => 'theme-default',
            ),
            $themes['crimson-focus']['fontDefaults']
        );
        $this->assertSame('crimson-focus', $registry->sanitize_id('crimson-focus'));
    }

    public function test_removed_md2html_normal_theme_is_not_registered_and_falls_back_to_default()
    {
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $this->assertArrayNotHasKey('md2html-normal', $themes);
        $this->assertSame('default', $registry->sanitize_id('md2html-normal'));
        $this->assertSame('default', $registry->get('md2html-normal')['id']);
    }

    public function test_third_party_can_re_register_removed_md2html_normal_theme()
    {
        $callback = static function ($themes) {
            $themes['md2html-normal'] = array(
                'id' => 'md2html-normal',
                'label' => 'Third-party Markdown2Html',
                'asset_path' => 'assets/themes/article/third-party-md2html-normal.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-md2html-normal',
            );

            return $themes;
        };

        add_filter('easymde_article_themes', $callback);

        try {
            $registry = new ArticleThemeRegistry();
            $themes = array_column($registry->for_script(), null, 'id');

            $this->assertArrayHasKey('md2html-normal', $themes);
            $this->assertSame('md2html-normal', $registry->sanitize_id('md2html-normal'));
            $this->assertSame('extension', $registry->get('md2html-normal')['origin']);
            $this->assertSame(
                'assets/themes/article/third-party-md2html-normal.css',
                $registry->get('md2html-normal')['asset_path']
            );
            $this->assertArrayNotHasKey('swatch', $themes['md2html-normal']);
        } finally {
            remove_filter('easymde_article_themes', $callback);
        }
    }

    public function test_filtered_builtin_theme_override_retains_registered_swatch()
    {
        $callback = static function ($themes) {
            $themes['orange-heart'] = array(
                'id' => 'orange-heart',
                'label' => 'Custom Orange heart',
                'asset_path' => 'assets/themes/article/custom-orange-heart.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-orange-heart',
            );

            return $themes;
        };

        add_filter('easymde_article_themes', $callback);

        try {
            $themes = array_column((new ArticleThemeRegistry())->for_script(), null, 'id');

            $this->assertSame('#ef7060', $themes['orange-heart']['swatch']);
            $this->assertSame(
                'assets/themes/article/custom-orange-heart.css',
                $themes['orange-heart']['assetPath']
            );
        } finally {
            remove_filter('easymde_article_themes', $callback);
        }
    }

    public function test_invalid_third_party_swatch_is_not_serialized_and_is_observable()
    {
        $callback = static function ($themes) {
            $themes['invalid-swatch'] = array(
                'id' => 'invalid-swatch',
                'label' => 'Invalid swatch',
                'asset_path' => 'assets/themes/article/invalid-swatch.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-invalid-swatch',
                'swatch' => 'var(--accent)',
            );

            return $themes;
        };
        $warnings = array();

        add_filter('easymde_article_themes', $callback);
        set_error_handler(
            static function ($severity, $message) use (&$warnings) {
                $warnings[] = array($severity, $message);
                return true;
            },
            E_USER_WARNING
        );

        try {
            $themes = array_column((new ArticleThemeRegistry())->for_script(), null, 'id');
        } finally {
            restore_error_handler();
            remove_filter('easymde_article_themes', $callback);
        }

        $this->assertArrayHasKey('invalid-swatch', $themes);
        $this->assertArrayNotHasKey('swatch', $themes['invalid-swatch']);
        $this->assertNotEmpty($warnings);
        $this->assertStringContainsString('invalid-article-theme-swatch:invalid-swatch', $warnings[0][1]);
    }

    public function test_typora_derived_themes_expose_asset_and_font_defaults_for_admin_script()
    {
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $expected = array(
            'qingbi-liujin' => array(
                'assetPath' => 'assets/themes/article/qingbi-liujin.css',
                'fontDefaults' => array(
                    'customFont' => 'helvetica',
                    'windowsFont' => 'no-windows-font',
                    'appleFont' => 'no-apple-font',
                    'serifFont' => 'sans-serif-only',
                ),
            ),
            'qinghe-zhusha' => array(
                'assetPath' => 'assets/themes/article/qinghe-zhusha.css',
                'fontDefaults' => array(
                    'customFont' => 'helvetica',
                    'windowsFont' => 'no-windows-font',
                    'appleFont' => 'no-apple-font',
                    'serifFont' => 'sans-serif-only',
                ),
            ),
        );

        foreach ($expected as $theme_id => $details) {
            $this->assertArrayHasKey($theme_id, $themes);
            $this->assertStringContainsString($details['assetPath'], $themes[$theme_id]['cssUrl']);
            $this->assertStringContainsString('ver=' . EASYMDE_VERSION, $themes[$theme_id]['cssUrl']);
            $this->assertSame($details['assetPath'], $themes[$theme_id]['assetPath']);
            $this->assertSame($details['fontDefaults'], $themes[$theme_id]['fontDefaults']);
        }
    }

    public function test_theme_font_defaults_use_only_canonical_visible_option_ids()
    {
        $registry = new ArticleThemeRegistry();
        $repository = new ThemeStateRepository(
            $registry,
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
        $font_options = $repository->get_theme_options_for_script(0)['fontOptions'];
        $allowed = array(
            'customFont' => array_column($font_options['customFonts'], 'id'),
            'windowsFont' => array_column($font_options['windowsFonts'], 'id'),
            'appleFont' => array_column($font_options['appleFonts'], 'id'),
            'serifFont' => array_column($font_options['serifOptions'], 'id'),
        );

        foreach ($registry->for_script() as $theme) {
            if (empty($theme['fontDefaults'])) {
                continue;
            }

            foreach ($theme['fontDefaults'] as $state_key => $option_id) {
                $this->assertContains($option_id, $allowed[$state_key], $theme['id'] . ':' . $state_key);
            }
        }
    }

    public function test_code_theme_registry_exposes_versioned_asset_urls_for_admin_script()
    {
        $registry = new CodeThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $expected = array(
            'github-dark' => 'assets/vendor/highlight/styles/github-dark.min.css',
            'atom-one-dark' => 'assets/vendor/highlight/styles/atom-one-dark.min.css',
            'monokai' => 'assets/vendor/highlight/styles/monokai.min.css',
            'vs2015' => 'assets/vendor/highlight/styles/vs2015.min.css',
            'terminal-noir' => 'assets/themes/code/terminal-noir.css',
            'fullstack-blue' => 'assets/themes/code/fullstack-blue.css',
        );

        foreach ($expected as $theme_id => $asset_path) {
            $this->assertArrayHasKey($theme_id, $themes);
            $this->assertStringContainsString($asset_path, $themes[$theme_id]['cssUrl']);
            $this->assertStringContainsString('ver=' . EASYMDE_VERSION, $themes[$theme_id]['cssUrl']);
        }
    }

    public function test_every_article_theme_exposes_a_registered_associated_code_theme()
    {
        $article_themes = (new ArticleThemeRegistry())->for_script();
        $code_themes = array_column((new CodeThemeRegistry())->for_script(), null, 'id');
        $this->assertCount(32, $article_themes);
        foreach ($article_themes as $article_theme) {
            $this->assertArrayHasKey($article_theme['defaultCodeTheme'], $code_themes);
        }

        $associations = array_column($article_themes, 'defaultCodeTheme', 'id');
        $this->assertSame('fullstack-blue', $associations['fullstack-blue']);
        unset($associations['fullstack-blue']);
        $this->assertSame(array('atom-one-dark'), array_values(array_unique($associations)));
    }

    public function test_every_builtin_article_theme_exposes_its_css_accent_swatch()
    {
        $themes = array_column((new ArticleThemeRegistry())->for_script(), 'swatch', 'id');
        $this->assertSame(
            array(
                'default'        => '#1d2327',
                'orange-heart'   => '#ef7060',
                'chazi-purple'   => '#773098',
                'green-vitality' => '#35b378',
                'red-crimson'    => '#f83929',
                'blue-ying'      => '#5c9dff',
                'crimson-focus'  => '#e74c3c',
                'inkwell'         => '#3b82c4',
                'inkwell-dark'    => '#6ba8e0',
                'nocturne'        => '#b080ff',
                'animal-island'   => '#19c8b9',
                'phycat-mint'     => '#3db8bf',
                'onedark'         => '#3e4249',
                'mdmdt'           => '#3e69d7',
                'dogschoice-pink' => '#f55066',
                'bloom-petal'     => '#e8859b',
                'spring'          => '#3ea173',
                'lanqing'        => '#009688',
                'yamabuki'       => '#ffb11b',
                'grid-black'     => '#212122',
                'geek-black'     => '#212122',
                'rose-purple'    => '#916dd5',
                'ningye-purple'  => '#916dd5',
                'tech-blue'      => '#0e88eb',
                'qingbi-liujin'  => '#1ea089',
                'qinghe-zhusha'  => '#4f7f22',
                'cute-green'     => '#48b378',
                'fullstack-blue' => '#40b8fa',
                'minimal-black'  => '#000000',
                'orange-blue'    => '#e7642b',
                'frontend-peak'  => '#3c70c6',
                'cupid-busy'     => '#827fc4',
            ),
            $themes
        );
        foreach ($themes as $theme_id => $swatch) {
            $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $swatch, $theme_id);
        }
    }

    public function test_typora_derived_theme_state_outputs_scoped_render_class()
    {
        $repository = new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );

        foreach (array('qingbi-liujin', 'qinghe-zhusha') as $theme_id) {
            $classes = $repository->get_rendered_content_classes(
                array(
                    'markdownTheme' => $theme_id,
                    'codeTheme' => 'atom-one-dark',
                    'fontFamily' => 'Helvetica, Arial, sans-serif',
                )
            );

            $this->assertStringContainsString('easymde-rendered-content', $classes);
            $this->assertStringContainsString('easymde-markdown-theme-' . $theme_id, $classes);
            $this->assertStringContainsString('easymde-code-theme-atom-one-dark', $classes);
            $this->assertStringContainsString('easymde-font-overrides', $classes);
            $this->assertStringNotContainsString('easymde-markdown-theme-custom', $classes);
        }
    }
}
