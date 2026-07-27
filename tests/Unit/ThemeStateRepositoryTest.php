<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class ThemeStateRepositoryTest extends WP_UnitTestCase
{
    private const LEGACY_CODE_MAC_STYLE_META = '_easymde_code_mac_style';

    public function test_post_theme_state_falls_back_to_default_when_removed_builtin_theme_is_stored()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'md2html-normal');

        $state = $this->theme_state_repository()->get_theme_state($post_id);

        $this->assertSame('default', $state['markdownTheme']);
    }

    public function test_user_default_theme_state_falls_back_to_default_without_writing_user_meta()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));

        wp_set_current_user($user_id);
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'markdownTheme' => 'md2html-normal',
                'codeTheme' => 'github',
                'codeMacStyle' => false,
                'customCssId' => '',
                'customFont' => 'optima',
                'windowsFont' => 'microsoft-yahei',
                'appleFont' => 'pingfang-sc-light',
                'serifFont' => 'yes',
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );

        $before = get_user_meta($user_id, 'easymde_default_theme_state', true);
        $state = $this->theme_state_repository()->get_theme_state(0);
        $after = get_user_meta($user_id, 'easymde_default_theme_state', true);

        $this->assertSame('default', $state['markdownTheme']);
        $this->assertArrayNotHasKey('codeMacStyle', $state);
        $this->assertSame($before, $after);
    }

    public function test_removed_theme_id_becomes_valid_again_when_a_third_party_registers_it()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );
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

        wp_set_current_user($user_id);
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'md2html-normal');
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'markdownTheme' => 'md2html-normal',
                'codeTheme' => 'github',
                'codeMacStyle' => false,
                'customCssId' => '',
                'customFont' => 'optima',
                'windowsFont' => 'microsoft-yahei',
                'appleFont' => 'pingfang-sc-light',
                'serifFont' => 'yes',
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );

        add_filter('easymde_article_themes', $callback);

        try {
            $repository = $this->theme_state_repository();
            $state = $repository->get_theme_state($post_id);
            $script_themes = array_column($repository->get_theme_options_for_script($post_id)['markdownThemes'], null, 'id');

            $this->assertSame('md2html-normal', $state['markdownTheme']);
            $this->assertArrayHasKey('md2html-normal', $script_themes);
            $this->assertSame('extension', $repository->get_article_theme('md2html-normal')['origin']);
            $this->assertArrayNotHasKey('codeMacStyle', $state);
        } finally {
            remove_filter('easymde_article_themes', $callback);
        }
    }

    public function test_legacy_post_values_do_not_enter_theme_state_or_control_rendered_classes()
    {
        $repository = $this->theme_state_repository();

        foreach (array('0', '1') as $legacy_value) {
            $post_id = self::factory()->post->create(array('post_type' => 'post'));
            update_post_meta($post_id, self::LEGACY_CODE_MAC_STYLE_META, $legacy_value);

            $state = $repository->get_theme_state($post_id);
            $classes = $repository->get_rendered_content_classes($state);

            $this->assertArrayNotHasKey('codeMacStyle', $state);
            $this->assertStringContainsString('easymde-code-mac', $classes);
            $this->assertSame($legacy_value, get_post_meta($post_id, self::LEGACY_CODE_MAC_STYLE_META, true));
        }
    }

    public function test_sanitized_request_state_has_no_legacy_mac_frame_field()
    {
        $state = $this->theme_state_repository()->sanitize_theme_state_from_request(
            array(
                'easymde_markdown_theme' => 'default',
                'easymde_code_theme' => 'github',
                'easymde_code_mac_style' => '0',
            )
        );

        $this->assertArrayNotHasKey('codeMacStyle', $state);
    }

    public function test_saving_active_defaults_preserves_legacy_unknown_fields_without_using_them()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'codeMacStyle' => false,
                'extensionPreference' => 'keep-me',
                'legacyBytes' => "keep\0exact",
                17 => 'keep-numeric-key',
            )
        );

        $this->theme_state_repository()->save_user_defaults(
            array(
                'markdownTheme' => 'orange-heart',
                'codeTheme' => 'github-dark',
                'customCssId' => '',
                'customFont' => 'optima',
                'windowsFont' => 'microsoft-yahei',
                'appleFont' => 'pingfang-sc-light',
                'serifFont' => 'yes',
            )
        );

        $stored = get_user_meta($user_id, 'easymde_default_theme_state', true);

        $this->assertFalse($stored['codeMacStyle']);
        $this->assertSame('keep-me', $stored['extensionPreference']);
        $this->assertSame("keep\0exact", $stored['legacyBytes']);
        $this->assertSame('keep-numeric-key', $stored[17]);
        $this->assertSame('orange-heart', $stored['markdownTheme']);
        $this->assertSame('github-dark', $stored['codeTheme']);
    }

    public function test_font_options_for_script_expose_only_canonical_user_choices()
    {
        $options = $this->theme_state_repository()->get_theme_options_for_script(0)['fontOptions'];

        $this->assertSame(
            array('none', 'optima', 'inter', 'helvetica', 'georgia', 'times', 'cochin', 'helvetica-neue'),
            array_column($options['customFonts'], 'id')
        );
        $this->assertSame(
            array('microsoft-yahei', 'no-windows-font'),
            array_column($options['windowsFonts'], 'id')
        );
        $this->assertSame(
            array('pingfang-sc-light', 'pingfang-sc-regular', 'pingfang-tc-light', 'pingfang-tc-regular', 'no-apple-font'),
            array_column($options['appleFonts'], 'id')
        );
        $this->assertSame(
            array('yes', 'serif-only', 'sans-serif-only', 'no'),
            array_column($options['serifOptions'], 'id')
        );

        $custom_fonts = array_column($options['customFonts'], null, 'id');
        $windows_fonts = array_column($options['windowsFonts'], null, 'id');
        $apple_fonts = array_column($options['appleFonts'], null, 'id');
        $serif_options = array_column($options['serifOptions'], null, 'id');
        $this->assertSame('None', $custom_fonts['none']['label']);
        $this->assertSame('None', $windows_fonts['no-windows-font']['label']);
        $this->assertSame('None', $apple_fonts['no-apple-font']['label']);
        $this->assertSame('None', $serif_options['no']['label']);
        $this->assertSame('Inter', $custom_fonts['inter']['fontFamily']);
        $this->assertSame('Helvetica, Arial', $custom_fonts['helvetica']['fontFamily']);
        $this->assertSame('"Microsoft YaHei", "微软雅黑"', $windows_fonts['microsoft-yahei']['fontFamily']);
        $this->assertSame('"PingFangSC-regular", "PingFang SC"', $apple_fonts['pingfang-sc-regular']['fontFamily']);
    }

    public function test_filtered_theme_legacy_font_defaults_are_canonicalized_for_script()
    {
        $callback = static function ($themes) {
            $themes['extension-legacy-fonts'] = array(
                'id' => 'extension-legacy-fonts',
                'label' => 'Extension legacy fonts',
                'asset_path' => 'assets/themes/article/extension-legacy-fonts.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-extension-legacy-fonts',
                'fontDefaults' => array(
                    'customFont' => 'red-crimson-inter',
                    'windowsFont' => 'red-crimson-microsoft-yahei',
                    'appleFont' => 'pingfang-sc-regular-raw',
                    'serifFont' => 'sans-serif-only',
                ),
            );

            return $themes;
        };

        add_filter('easymde_article_themes', $callback);

        try {
            $themes = array_column(
                $this->theme_state_repository()->get_theme_options_for_script(0)['markdownThemes'],
                null,
                'id'
            );

            $this->assertSame(
                array(
                    'customFont' => 'inter',
                    'windowsFont' => 'microsoft-yahei',
                    'appleFont' => 'pingfang-sc-regular',
                    'serifFont' => 'sans-serif-only',
                ),
                $themes['extension-legacy-fonts']['fontDefaults']
            );
        } finally {
            remove_filter('easymde_article_themes', $callback);
        }
    }

    public function test_legacy_theme_font_ids_are_normalized_without_writing_post_meta()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'red-crimson');
        update_post_meta($post_id, PostDocument::META_CUSTOM_FONT, 'red-crimson-inter');
        update_post_meta($post_id, PostDocument::META_WINDOWS_FONT, 'red-crimson-microsoft-yahei');
        update_post_meta($post_id, PostDocument::META_APPLE_FONT, 'pingfang-sc-regular-raw');
        update_post_meta($post_id, PostDocument::META_SERIF_FONT, 'sans-serif-only');

        $before = get_post_meta($post_id);
        $state = $this->theme_state_repository()->get_theme_state($post_id);
        $after = get_post_meta($post_id);

        $this->assertSame('inter', $state['customFont']);
        $this->assertSame('microsoft-yahei', $state['windowsFont']);
        $this->assertSame('pingfang-sc-regular', $state['appleFont']);
        $this->assertSame('sans-serif-only', $state['serifFont']);
        $this->assertSame($before, $after);
    }

    public function test_legacy_user_default_font_stack_applies_the_current_post_theme_without_writing_meta()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'markdownTheme' => 'orange-heart',
                'codeTheme' => 'atom-one-dark',
                'customCssId' => '',
                'customFont' => 'orange-heart-inter',
                'windowsFont' => 'orange-heart-microsoft-yahei',
                'appleFont' => 'pingfang-sc-regular-raw',
                'serifFont' => 'sans-serif-only',
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'rose-purple');

        $before_user_meta = get_user_meta($user_id, 'easymde_default_theme_state', true);
        $before_post_meta = get_post_meta($post_id);
        $state = $this->theme_state_repository()->get_theme_state($post_id);

        $this->assertSame('rose-purple', $state['markdownTheme']);
        $this->assertSame('optima', $state['customFont']);
        $this->assertSame('microsoft-yahei', $state['windowsFont']);
        $this->assertSame('pingfang-sc-regular', $state['appleFont']);
        $this->assertSame('serif-only', $state['serifFont']);
        $this->assertSame($before_user_meta, get_user_meta($user_id, 'easymde_default_theme_state', true));
        $this->assertSame($before_post_meta, get_post_meta($post_id));
    }

    public function test_canonical_user_theme_defaults_follow_partial_posts_selected_theme_without_writing_meta()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'markdownTheme' => 'red-crimson',
                'codeTheme' => 'atom-one-dark',
                'customCssId' => '',
                'customFont' => 'inter',
                'windowsFont' => 'microsoft-yahei',
                'appleFont' => 'pingfang-sc-regular',
                'serifFont' => 'sans-serif-only',
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'rose-purple');

        $before_user_meta = get_user_meta($user_id, 'easymde_default_theme_state', true);
        $before_post_meta = get_post_meta($post_id);
        $state = $this->theme_state_repository()->get_theme_state($post_id);

        $this->assertSame('rose-purple', $state['markdownTheme']);
        $this->assertSame('optima', $state['customFont']);
        $this->assertSame('microsoft-yahei', $state['windowsFont']);
        $this->assertSame('pingfang-sc-regular', $state['appleFont']);
        $this->assertSame('serif-only', $state['serifFont']);
        $this->assertSame($before_user_meta, get_user_meta($user_id, 'easymde_default_theme_state', true));
        $this->assertSame($before_post_meta, get_post_meta($post_id));
    }

    public function test_explicit_canonical_user_fonts_do_not_follow_an_unrelated_default_theme()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'markdownTheme' => 'default',
                'codeTheme' => 'atom-one-dark',
                'customCssId' => '',
                'customFont' => 'inter',
                'windowsFont' => 'microsoft-yahei',
                'appleFont' => 'pingfang-sc-regular',
                'serifFont' => 'sans-serif-only',
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'rose-purple');

        $state = $this->theme_state_repository()->get_theme_state($post_id);

        $this->assertSame('rose-purple', $state['markdownTheme']);
        $this->assertSame('inter', $state['customFont']);
        $this->assertSame('microsoft-yahei', $state['windowsFont']);
        $this->assertSame('pingfang-sc-regular', $state['appleFont']);
        $this->assertSame('sans-serif-only', $state['serifFont']);
    }

    public function test_legacy_user_defaults_apply_filtered_theme_font_defaults_without_writing_meta()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );
        $callback = static function ($themes) {
            $themes['extension-legacy-fonts'] = array(
                'id' => 'extension-legacy-fonts',
                'label' => 'Extension legacy fonts',
                'asset_path' => 'assets/themes/article/extension-legacy-fonts.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-extension-legacy-fonts',
                'fontDefaults' => array(
                    'customFont' => 'qingbi-liujin-helvetica',
                    'windowsFont' => 'qingbi-liujin-no-windows',
                    'appleFont' => 'qingbi-liujin-no-apple',
                    'serifFont' => 'sans-serif-only',
                ),
            );

            return $themes;
        };

        wp_set_current_user($user_id);
        update_user_meta(
            $user_id,
            'easymde_default_theme_state',
            array(
                'markdownTheme' => 'orange-heart',
                'codeTheme' => 'atom-one-dark',
                'customCssId' => '',
                'customFont' => 'orange-heart-inter',
                'windowsFont' => 'orange-heart-microsoft-yahei',
                'appleFont' => 'pingfang-sc-regular-raw',
                'serifFont' => 'sans-serif-only',
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'extension-legacy-fonts');
        add_filter('easymde_article_themes', $callback);

        try {
            $before_user_meta = get_user_meta($user_id, 'easymde_default_theme_state', true);
            $before_post_meta = get_post_meta($post_id);
            $state = $this->theme_state_repository()->get_theme_state($post_id);

            $this->assertSame('extension-legacy-fonts', $state['markdownTheme']);
            $this->assertSame('helvetica', $state['customFont']);
            $this->assertSame('no-windows-font', $state['windowsFont']);
            $this->assertSame('no-apple-font', $state['appleFont']);
            $this->assertSame('sans-serif-only', $state['serifFont']);
            $this->assertSame($before_user_meta, get_user_meta($user_id, 'easymde_default_theme_state', true));
            $this->assertSame($before_post_meta, get_post_meta($post_id));
        } finally {
            remove_filter('easymde_article_themes', $callback);
        }
    }

    public function test_explicit_canonical_font_ids_are_not_replaced_by_theme_defaults_on_read()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'rose-purple');
        update_post_meta($post_id, PostDocument::META_CUSTOM_FONT, 'inter');
        update_post_meta($post_id, PostDocument::META_WINDOWS_FONT, 'microsoft-yahei');
        update_post_meta($post_id, PostDocument::META_APPLE_FONT, 'pingfang-sc-regular');
        update_post_meta($post_id, PostDocument::META_SERIF_FONT, 'sans-serif-only');

        $state = $this->theme_state_repository()->get_theme_state($post_id);

        $this->assertSame('inter', $state['customFont']);
        $this->assertSame('microsoft-yahei', $state['windowsFont']);
        $this->assertSame('pingfang-sc-regular', $state['appleFont']);
        $this->assertSame('sans-serif-only', $state['serifFont']);
    }

    public function test_request_sanitization_normalizes_every_legacy_font_alias()
    {
        $aliases = array(
            'easymde_custom_font' => array(
                'orange-heart-inter' => 'inter',
                'red-crimson-inter' => 'inter',
                'rose-purple-optima' => 'optima',
                'ningye-purple-inter' => 'inter',
                'cupid-busy-inter' => 'inter',
                'tech-blue-optima' => 'optima',
                'qingbi-liujin-helvetica' => 'helvetica',
                'qinghe-zhusha-helvetica' => 'helvetica',
            ),
            'easymde_windows_font' => array(
                'orange-heart-microsoft-yahei' => 'microsoft-yahei',
                'red-crimson-microsoft-yahei' => 'microsoft-yahei',
                'rose-purple-microsoft-yahei' => 'microsoft-yahei',
                'ningye-purple-microsoft-yahei' => 'microsoft-yahei',
                'cupid-busy-microsoft-yahei' => 'microsoft-yahei',
                'tech-blue-microsoft-yahei' => 'microsoft-yahei',
                'qingbi-liujin-no-windows' => 'no-windows-font',
                'qinghe-zhusha-no-windows' => 'no-windows-font',
            ),
            'easymde_apple_font' => array(
                'pingfang-sc-regular-raw' => 'pingfang-sc-regular',
                'qingbi-liujin-no-apple' => 'no-apple-font',
                'qinghe-zhusha-no-apple' => 'no-apple-font',
            ),
        );
        $state_keys = array(
            'easymde_custom_font' => 'customFont',
            'easymde_windows_font' => 'windowsFont',
            'easymde_apple_font' => 'appleFont',
        );

        foreach ($aliases as $request_key => $group_aliases) {
            foreach ($group_aliases as $legacy_id => $canonical_id) {
                $state = $this->theme_state_repository()->sanitize_theme_state_from_request(
                    array(
                        'easymde_markdown_theme' => 'default',
                        'easymde_code_theme' => 'atom-one-dark',
                        'easymde_custom_font' => 'none',
                        'easymde_windows_font' => 'microsoft-yahei',
                        'easymde_apple_font' => 'pingfang-sc-light',
                        'easymde_serif_font' => 'yes',
                        $request_key => $legacy_id,
                    )
                );

                $this->assertSame($canonical_id, $state[$state_keys[$request_key]], $legacy_id);
            }
        }
    }

    public function test_request_sanitization_does_not_replace_mixed_explicit_font_choices()
    {
        $state = $this->theme_state_repository()->sanitize_theme_state_from_request(
            array(
                'easymde_markdown_theme' => 'rose-purple',
                'easymde_code_theme' => 'atom-one-dark',
                'easymde_custom_font' => 'red-crimson-inter',
                'easymde_windows_font' => 'no-windows-font',
                'easymde_apple_font' => 'pingfang-tc-regular',
                'easymde_serif_font' => 'sans-serif-only',
            )
        );

        $this->assertSame('inter', $state['customFont']);
        $this->assertSame('no-windows-font', $state['windowsFont']);
        $this->assertSame('pingfang-tc-regular', $state['appleFont']);
        $this->assertSame('sans-serif-only', $state['serifFont']);
    }

    public function test_request_without_font_fields_applies_selected_theme_defaults()
    {
        $state = $this->theme_state_repository()->sanitize_theme_state_from_request(
            array(
                'easymde_markdown_theme' => 'red-crimson',
                'easymde_code_theme' => 'atom-one-dark',
            )
        );

        $this->assertSame('inter', $state['customFont']);
        $this->assertSame('microsoft-yahei', $state['windowsFont']);
        $this->assertSame('pingfang-sc-regular', $state['appleFont']);
        $this->assertSame('sans-serif-only', $state['serifFont']);
    }

    private function theme_state_repository()
    {
        return new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
    }
}
