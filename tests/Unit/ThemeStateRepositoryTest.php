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

    private function theme_state_repository()
    {
        return new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
    }
}
