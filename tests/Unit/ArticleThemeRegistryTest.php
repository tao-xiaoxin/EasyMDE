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

    public function test_dogschoice_qicaihong_theme_keeps_the_source_label_and_asset()
    {
        $registry = new ArticleThemeRegistry();
        $theme = $registry->get('dogschoice-pink');

        $this->assertSame("Dog's Choice Pink", $theme['label']);
        $this->assertSame('assets/themes/article/dogschoice-pink.css', $theme['asset_path']);
        $this->assertSame('easymde-markdown-theme-dogschoice-pink', $theme['class_name']);
        $this->assertSame('dogschoice-pink', $registry->sanitize_id('dogschoice-pink'));
    }

    public function test_typora_derived_article_theme_labels_use_english_source_messages()
    {
        $expected = array(
            'inkwell'         => 'Inkwell',
            'animal-island'   => 'Animal Island',
            'phycat-cherry'   => 'Phycat Cherry',
            'phycat-caramel'  => 'Phycat Caramel',
            'phycat-forest'   => 'Phycat Forest',
            'phycat-mint'     => 'Phycat Mint',
            'phycat-sky'      => 'Phycat Sky',
            'phycat-prussian' => 'Phycat Prussian',
            'phycat-sakura'   => 'Phycat Sakura',
            'phycat-mauve'    => 'Phycat Mauve',
            'mdmdt'           => 'Mdmdt Light',
            'dogschoice-pink' => "Dog's Choice Pink",
            'bloom-petal'     => 'Bloom Petal',
            'bloom-mist'      => 'Bloom Mist',
            'bloom-verdant'   => 'Bloom Verdant',
            'bloom-stone'     => 'Bloom Stone',
            'bloom-wheat'     => 'Bloom Wheat',
            'bloom-ink'       => 'Bloom Ink',
            'bloom-amber'     => 'Bloom Amber',
            'bloom-lapis'     => 'Bloom Lapis',
            'bloom-ripple'    => 'Bloom Ripple',
            'bloom-cinnabar'  => 'Bloom Cinnabar',
            'bloom-sage'      => 'Bloom Sage',
            'bloom-spring'    => 'Bloom Spring',
            'spring'          => 'Spring',
        );
        $themes = array_column((new ArticleThemeRegistry())->for_script(), 'label', 'id');

        foreach ($expected as $theme_id => $label) {
            $this->assertArrayHasKey($theme_id, $themes);
            $this->assertSame($label, $themes[$theme_id]);
            $this->assertStringNotContainsString('（', $themes[$theme_id]);
            $this->assertStringNotContainsString('(', $themes[$theme_id]);
        }
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

    public function test_retired_black_theme_is_not_registered_and_falls_back_to_default()
    {
        $theme_id = implode('-', array('geek', 'black'));
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $this->assertArrayNotHasKey($theme_id, $themes);
        $this->assertSame('default', $registry->sanitize_id($theme_id));
        $this->assertSame('default', $registry->get($theme_id)['id']);
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

    public function test_filtered_registries_restore_only_the_required_fallback_after_valid_removals()
    {
        $article_callback = static function ($themes) {
            return array(
                'extension-article' => array(
                    'id' => 'extension-article',
                    'label' => 'Extension article',
                    'asset_path' => 'assets/themes/article/extension-article.css',
                    'origin' => 'extension',
                    'class_name' => 'easymde-markdown-theme-extension-article',
                ),
            );
        };
        $code_callback = static function ($themes) {
            return array(
                'github' => $themes['github'],
                'github-dark' => $themes['github-dark'],
                'extension-code' => array(
                    'id' => 'extension-code',
                    'label' => 'Extension code',
                    'asset_path' => 'assets/themes/code/extension-code.css',
                    'origin' => 'extension',
                ),
            );
        };
        $warnings = array();

        add_filter('easymde_article_themes', $article_callback);
        add_filter('easymde_code_themes', $code_callback);
        set_error_handler(
            static function ($severity, $message) use (&$warnings) {
                $warnings[] = array($severity, $message);
                return true;
            },
            E_USER_WARNING
        );

        try {
            $article_themes = (new ArticleThemeRegistry())->all();
            $code_themes = (new CodeThemeRegistry())->all();
        } finally {
            restore_error_handler();
            remove_filter('easymde_code_themes', $code_callback);
            remove_filter('easymde_article_themes', $article_callback);
        }

        $this->assertSame(array('default', 'extension-article'), array_keys($article_themes));
        $this->assertSame('default', $article_themes['default']['id']);
        $this->assertSame(
            array('github', 'github-dark', 'atom-one-dark', 'extension-code'),
            array_keys($code_themes)
        );
        $this->assertSame('atom-one-dark', $code_themes['atom-one-dark']['id']);
        $messages = implode("\n", array_column($warnings, 1));
        $this->assertStringContainsString('article-theme-fallback-restored:default', $messages);
        $this->assertStringContainsString('code-theme-fallback-restored:atom-one-dark', $messages);
    }

    public function test_filtered_theme_identity_must_be_a_canonical_matching_associative_key()
    {
        $article_callback = static function ($themes) {
            $filtered_themes = array(
                'valid-extension' => array(
                    'id' => 'valid-extension',
                    'label' => 'First valid extension',
                    'asset_path' => 'assets/themes/article/valid-extension.css',
                    'origin' => 'extension',
                    'class_name' => 'easymde-markdown-theme-valid-extension',
                ),
                'duplicate-extension' => array(
                    'id' => 'valid-extension',
                    'label' => 'Duplicate extension',
                    'asset_path' => 'assets/themes/article/duplicate-extension.css',
                    'origin' => 'extension',
                    'class_name' => 'easymde-markdown-theme-duplicate-extension',
                ),
                'mismatched-extension' => array(
                    'id' => 'different-extension',
                    'label' => 'Mismatched extension',
                    'asset_path' => 'assets/themes/article/mismatched-extension.css',
                    'origin' => 'extension',
                    'class_name' => 'easymde-markdown-theme-mismatched-extension',
                ),
                0 => array(
                    'id' => 'numeric-extension',
                    'label' => 'Numeric extension',
                    'asset_path' => 'assets/themes/article/numeric-extension.css',
                    'origin' => 'extension',
                    'class_name' => 'easymde-markdown-theme-numeric-extension',
                ),
                'Uppercase-Extension' => array(
                    'id' => 'Uppercase-Extension',
                    'label' => 'Uppercase extension',
                    'asset_path' => 'assets/themes/article/uppercase-extension.css',
                    'origin' => 'extension',
                    'class_name' => 'easymde-markdown-theme-uppercase-extension',
                ),
            );
            $long_id = str_repeat('a', 201);
            $filtered_themes[$long_id] = array(
                'id' => $long_id,
                'label' => 'Too long extension',
                'asset_path' => 'assets/themes/article/too-long-extension.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-too-long-extension',
            );

            return $filtered_themes;
        };
        $code_callback = static function ($themes) {
            $filtered_themes = array(
                'valid-code-extension' => array(
                    'id' => 'valid-code-extension',
                    'label' => 'First valid code extension',
                    'asset_path' => 'assets/themes/code/valid-code-extension.css',
                    'origin' => 'extension',
                ),
                'duplicate-code-extension' => array(
                    'id' => 'valid-code-extension',
                    'label' => 'Duplicate code extension',
                    'asset_path' => 'assets/themes/code/duplicate-code-extension.css',
                    'origin' => 'extension',
                ),
                'mismatched-code-extension' => array(
                    'id' => 'different-code-extension',
                    'label' => 'Mismatched code extension',
                    'asset_path' => 'assets/themes/code/mismatched-code-extension.css',
                    'origin' => 'extension',
                ),
                0 => array(
                    'id' => 'numeric-code-extension',
                    'label' => 'Numeric code extension',
                    'asset_path' => 'assets/themes/code/numeric-code-extension.css',
                    'origin' => 'extension',
                ),
                'Uppercase-Code-Extension' => array(
                    'id' => 'Uppercase-Code-Extension',
                    'label' => 'Uppercase code extension',
                    'asset_path' => 'assets/themes/code/uppercase-code-extension.css',
                    'origin' => 'extension',
                ),
            );
            $long_id = str_repeat('b', 201);
            $filtered_themes[$long_id] = array(
                'id' => $long_id,
                'label' => 'Too long code extension',
                'asset_path' => 'assets/themes/code/too-long-code-extension.css',
                'origin' => 'extension',
            );

            return $filtered_themes;
        };
        $warnings = array();

        add_filter('easymde_article_themes', $article_callback);
        add_filter('easymde_code_themes', $code_callback);
        set_error_handler(
            static function ($severity, $message) use (&$warnings) {
                $warnings[] = array($severity, $message);
                return true;
            },
            E_USER_WARNING
        );

        try {
            $article_registry = new ArticleThemeRegistry();
            $code_registry = new CodeThemeRegistry();
            $article_themes = $article_registry->all();
            $code_themes = $code_registry->all();
            $article_id = $article_registry->sanitize_id('valid-extension');
            $code_id = $code_registry->sanitize_id('valid-code-extension');
        } finally {
            restore_error_handler();
            remove_filter('easymde_code_themes', $code_callback);
            remove_filter('easymde_article_themes', $article_callback);
        }

        $this->assertSame(array('default', 'valid-extension'), array_keys($article_themes));
        $this->assertSame('First valid extension', $article_themes['valid-extension']['label']);
        $this->assertSame('valid-extension', $article_id);
        foreach ($article_themes as $key => $theme) {
            $this->assertSame($key, $theme['id']);
        }
        $this->assertSame(array('atom-one-dark', 'valid-code-extension'), array_keys($code_themes));
        $this->assertSame('First valid code extension', $code_themes['valid-code-extension']['label']);
        $this->assertSame('valid-code-extension', $code_id);
        foreach ($code_themes as $key => $theme) {
            $this->assertSame($key, $theme['id']);
        }
        $messages = implode("\n", array_column($warnings, 1));
        $this->assertStringContainsString('duplicate-article-theme-id:valid-extension', $messages);
        $this->assertStringContainsString('article-theme-key-id-mismatch:mismatched-extension:different-extension', $messages);
        $this->assertStringContainsString('invalid-article-theme-key:numeric-key', $messages);
        $this->assertStringContainsString('invalid-article-theme-key:uppercase-extension', $messages);
        $this->assertStringContainsString('invalid-article-theme-key:too-long-key', $messages);
        $this->assertStringContainsString('duplicate-code-theme-id:valid-code-extension', $messages);
        $this->assertStringContainsString('code-theme-key-id-mismatch:mismatched-code-extension:different-code-extension', $messages);
        $this->assertStringContainsString('invalid-code-theme-key:numeric-key', $messages);
        $this->assertStringContainsString('invalid-code-theme-key:uppercase-code-extension', $messages);
        $this->assertStringContainsString('invalid-code-theme-key:too-long-key', $messages);
    }

    public function test_malformed_filtered_descriptors_are_ignored_without_breaking_serialization()
    {
        $article_callback = static function ($themes) {
            $themes['scalar-article'] = 'not-an-array';
            $themes['missing-article-field'] = array(
                'id' => 'missing-article-field',
                'label' => 'Missing article field',
                'asset_path' => 'assets/themes/article/missing-article-field.css',
                'origin' => 'extension',
            );
            $themes['invalid-default-code'] = array(
                'id' => 'invalid-default-code',
                'label' => 'Invalid default code',
                'asset_path' => 'assets/themes/article/invalid-default-code.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-invalid-default-code',
                'default_code_theme' => array('invalid'),
            );

            return $themes;
        };
        $code_callback = static function ($themes) {
            $themes['scalar-code'] = 42;
            $themes['missing-code-field'] = array(
                'id' => 'missing-code-field',
                'label' => 'Missing code field',
                'asset_path' => 'assets/themes/code/missing-code-field.css',
            );

            return $themes;
        };
        $warnings = array();

        add_filter('easymde_article_themes', $article_callback);
        add_filter('easymde_code_themes', $code_callback);
        set_error_handler(
            static function ($severity, $message) use (&$warnings) {
                $warnings[] = array($severity, $message);
                return true;
            },
            E_USER_WARNING
        );

        try {
            $article_themes = array_column((new ArticleThemeRegistry())->for_script(), null, 'id');
            $code_themes = array_column((new CodeThemeRegistry())->for_script(), null, 'id');
        } finally {
            restore_error_handler();
            remove_filter('easymde_code_themes', $code_callback);
            remove_filter('easymde_article_themes', $article_callback);
        }

        $this->assertArrayNotHasKey('scalar-article', $article_themes);
        $this->assertArrayNotHasKey('missing-article-field', $article_themes);
        $this->assertArrayNotHasKey('invalid-default-code', $article_themes);
        $this->assertArrayNotHasKey('scalar-code', $code_themes);
        $this->assertArrayNotHasKey('missing-code-field', $code_themes);
        $messages = implode("\n", array_column($warnings, 1));
        $this->assertStringContainsString('invalid-article-theme-descriptor:scalar-article', $messages);
        $this->assertStringContainsString('invalid-article-theme-field:missing-article-field:class_name', $messages);
        $this->assertStringContainsString('invalid-article-theme-field:invalid-default-code:default_code_theme', $messages);
        $this->assertStringContainsString('invalid-code-theme-descriptor:scalar-code', $messages);
        $this->assertStringContainsString('invalid-code-theme-field:missing-code-field:origin', $messages);
    }

    public function test_non_array_filter_results_are_ignored_with_an_observable_warning()
    {
        $article_callback = static function ($themes) {
            return 'invalid-article-registry';
        };
        $code_callback = static function ($themes) {
            return null;
        };
        $warnings = array();

        add_filter('easymde_article_themes', $article_callback);
        add_filter('easymde_code_themes', $code_callback);
        set_error_handler(
            static function ($severity, $message) use (&$warnings) {
                $warnings[] = array($severity, $message);
                return true;
            },
            E_USER_WARNING
        );

        try {
            $article_themes = (new ArticleThemeRegistry())->all();
            $code_themes = (new CodeThemeRegistry())->all();
        } finally {
            restore_error_handler();
            remove_filter('easymde_code_themes', $code_callback);
            remove_filter('easymde_article_themes', $article_callback);
        }

        $this->assertCount(46, $article_themes);
        $this->assertArrayHasKey('default', $article_themes);
        $this->assertCount(28, $code_themes);
        $this->assertArrayHasKey('atom-one-dark', $code_themes);
        $messages = implode("\n", array_column($warnings, 1));
        $this->assertStringContainsString('invalid-article-theme-registry', $messages);
        $this->assertStringContainsString('invalid-code-theme-registry', $messages);
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
            'inkwell-code' => 'assets/themes/code/typora-derived.css',
            'animal-island-code' => 'assets/themes/code/typora-derived.css',
            'spring-code' => 'assets/themes/code/typora-derived.css',
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
        $this->assertCount(46, $article_themes);
        foreach ($article_themes as $article_theme) {
            $this->assertArrayHasKey($article_theme['defaultCodeTheme'], $code_themes);
        }

        $associations = array_column($article_themes, 'defaultCodeTheme', 'id');
        $this->assertSame('fullstack-blue', $associations['fullstack-blue']);
        $typora_associations = array(
            'inkwell' => 'inkwell-code',
            'animal-island' => 'animal-island-code',
            'phycat-cherry' => 'phycat-code',
            'phycat-caramel' => 'phycat-code',
            'phycat-forest' => 'phycat-code',
            'phycat-mint' => 'phycat-code',
            'phycat-sky' => 'phycat-code',
            'phycat-prussian' => 'phycat-code',
            'phycat-sakura' => 'phycat-code',
            'phycat-mauve' => 'phycat-code',
            'mdmdt' => 'mdmdt-code',
            'dogschoice-pink' => 'dogschoice-pink-code',
            'bloom-petal' => 'bloom-petal-code',
            'bloom-mist' => 'bloom-mist-code',
            'bloom-verdant' => 'bloom-verdant-code',
            'bloom-stone' => 'bloom-stone-code',
            'bloom-wheat' => 'bloom-wheat-code',
            'bloom-ink' => 'bloom-ink-code',
            'bloom-amber' => 'bloom-amber-code',
            'bloom-lapis' => 'bloom-lapis-code',
            'bloom-ripple' => 'bloom-ripple-code',
            'bloom-cinnabar' => 'bloom-cinnabar-code',
            'bloom-sage' => 'bloom-sage-code',
            'bloom-spring' => 'bloom-spring-code',
            'spring' => 'spring-code',
        );
        foreach ($typora_associations as $article_id => $code_id) {
            $this->assertSame($code_id, $associations[$article_id]);
        }
        foreach (array_keys($typora_associations) as $article_id) {
            unset($associations[$article_id]);
        }
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
                'animal-island'   => '#19c8b9',
                'phycat-cherry'   => '#aa1111',
                'phycat-caramel'  => '#f59e0b',
                'phycat-forest'   => '#11aa63',
                'phycat-mint'     => '#3db8bf',
                'phycat-sky'      => '#3498db',
                'phycat-prussian' => '#1d4e89',
                'phycat-sakura'   => '#ff7096',
                'phycat-mauve'    => '#a06eb4',
                'mdmdt'           => '#3e69d7',
                'dogschoice-pink' => '#f55066',
                'bloom-petal'     => '#e63f9f',
                'bloom-mist'      => '#34698c',
                'bloom-verdant'   => '#3d7055',
                'bloom-stone'     => '#82564f',
                'bloom-wheat'     => '#947d53',
                'bloom-ink'       => '#a74639',
                'bloom-amber'     => '#b77b29',
                'bloom-lapis'     => '#2f62ac',
                'bloom-ripple'    => '#009c9c',
                'bloom-cinnabar'  => '#c53637',
                'bloom-sage'      => '#848e38',
                'bloom-spring'    => '#877deb',
                'spring'          => '#3ea173',
                'lanqing'        => '#009688',
                'yamabuki'       => '#ffb11b',
                'grid-black'     => '#212122',
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
