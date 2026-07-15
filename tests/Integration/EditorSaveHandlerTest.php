<?php

use EasyMDE\Admin\EditorSaveHandler;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class EditorSaveHandlerTest extends WP_UnitTestCase
{
    public function test_invalid_save_nonce_does_not_mark_existing_ordinary_post_enabled()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('not_easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => '# Should not be saved',
        );

        try {
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $this->theme_state_repository(),
                function () {
                    return true;
                }
            );
            $handler->save_post_meta($post_id, get_post($post_id), true);

            $this->assertFalse((new PostDocument())->is_easymde_post($post_id));
        } finally {
            $_POST = $previous_post;
        }
    }

    public function test_legacy_markdown_post_is_lazy_migrated_on_valid_save()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        add_post_meta($post_id, PostDocument::META_MARKDOWN, '');

        $document = new PostDocument();
        $this->assertTrue($document->is_easymde_post($post_id));
        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_ENABLED));

        wp_set_current_user($user_id);

        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => '# Migrated',
            'easymde_markdown_theme' => 'default',
            'easymde_code_theme' => 'github',
        );

        try {
            $handler = new EditorSaveHandler(
                $document,
                $this->theme_state_repository(),
                function () {
                    return true;
                }
            );
            $handler->save_post_meta($post_id, get_post($post_id), true);

            $this->assertSame('1', get_post_meta($post_id, PostDocument::META_ENABLED, true));
            $this->assertSame('# Migrated', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
            $this->assertSame('default', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
            $this->assertSame('github', get_post_meta($post_id, PostDocument::META_CODE_THEME, true));
            $this->assertFalse(metadata_exists('post', $post_id, '_easymde_code_mac_style'));
        } finally {
            $_POST = $previous_post;
        }
    }

    public function test_existing_ordinary_post_save_establishes_markdown_state_and_rendered_content()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
                'post_content' => '<p>Existing HTML before EasyMDE.</p>',
            )
        );

        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_ENABLED));
        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_MARKDOWN));

        wp_set_current_user($user_id);

        $markdown = "# Existing Ordinary\n\nSaved through **EasyMDE**.";
        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => $markdown,
            'easymde_markdown_theme' => 'default',
            'easymde_code_theme' => 'github',
        );

        try {
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $this->theme_state_repository(),
                function () {
                    return true;
                }
            );

            $rendered = $handler->render_markdown_post_content(
                array(
                    'post_type' => 'post',
                    'post_content' => '<p>Existing HTML before EasyMDE.</p>',
                ),
                array(
                    'ID' => $post_id,
                    'post_type' => 'post',
                )
            );

            $this->assertStringContainsString('Existing Ordinary', $rendered['post_content']);
            $this->assertStringContainsString('<strong>EasyMDE</strong>', $rendered['post_content']);

            $save_post = $_POST;
            $_POST = array();
            wp_update_post(
                array(
                    'ID' => $post_id,
                    'post_content' => $rendered['post_content'],
                )
            );
            $_POST = $save_post;

            $handler->save_post_meta($post_id, get_post($post_id), true);

            $this->assertSame('1', get_post_meta($post_id, PostDocument::META_ENABLED, true));
            $this->assertSame($markdown, get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
            $this->assertSame('default', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
            $this->assertSame('github', get_post_meta($post_id, PostDocument::META_CODE_THEME, true));
            $this->assertFalse(metadata_exists('post', $post_id, '_easymde_code_mac_style'));
            $this->assertSame($rendered['post_content'], get_post($post_id)->post_content);
            $this->assertSame(
                (new PostDocument())->render_signature($markdown, 'default', $rendered['post_content']),
                get_post_meta($post_id, PostDocument::META_RENDER_SIGNATURE, true)
            );
        } finally {
            $_POST = $previous_post;
        }
    }

    public function test_removed_builtin_theme_request_is_saved_as_default_theme_state()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
                'post_content' => '<p>Before save.</p>',
            )
        );

        wp_set_current_user($user_id);

        $markdown = "# Removed built-in theme\n\nSaved with a legacy theme identifier.";
        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => $markdown,
            'easymde_markdown_theme' => 'md2html-normal',
            'easymde_code_theme' => 'github',
        );

        try {
            $repository = $this->theme_state_repository();
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $repository,
                function () {
                    return true;
                }
            );

            $rendered = $handler->render_markdown_post_content(
                array(
                    'post_type' => 'post',
                    'post_content' => '<p>Before save.</p>',
                ),
                array(
                    'ID' => $post_id,
                    'post_type' => 'post',
                )
            );

            $save_post = $_POST;
            $_POST = array();
            wp_update_post(
                array(
                    'ID' => $post_id,
                    'post_content' => $rendered['post_content'],
                )
            );
            $_POST = $save_post;

            $handler->save_post_meta($post_id, get_post($post_id), true);

            $this->assertSame('default', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
            $this->assertSame(
                'default',
                get_user_meta($user_id, 'easymde_default_theme_state', true)['markdownTheme']
            );
        } finally {
            $_POST = $previous_post;
        }
    }

    public function test_missing_renderer_aborts_save_before_content_changes()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
                'post_content' => '<p>Rendered HTML</p>',
            )
        );

        wp_set_current_user($user_id);
        add_filter('wp_die_handler', array($this, 'throwing_wp_die_handler'));

        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => '# Raw Markdown',
        );

        try {
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $this->theme_state_repository(),
                function () {
                    return false;
                }
            );

            $data = array(
                'post_type' => 'post',
                'post_content' => '# Raw Markdown',
            );
            $postarr = array(
                'ID' => $post_id,
                'post_type' => 'post',
            );

            try {
                $handler->render_markdown_post_content($data, $postarr);
                $this->fail('Expected EasyMDE save to abort when the renderer is unavailable.');
            } catch (\RuntimeException $exception) {
                $this->assertStringContainsString('Markdown rendering is unavailable', $exception->getMessage());
            }

            $this->assertSame('<p>Rendered HTML</p>', get_post($post_id)->post_content);
        } finally {
            $_POST = $previous_post;
            remove_filter('wp_die_handler', array($this, 'throwing_wp_die_handler'));
        }
    }

    public function test_missing_renderer_aborts_new_post_save_before_blank_content()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);
        add_filter('wp_die_handler', array($this, 'throwing_wp_die_handler'));

        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => '# New Markdown',
        );

        try {
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $this->theme_state_repository(),
                function () {
                    return false;
                }
            );

            $data = array(
                'post_type' => 'post',
                'post_content' => '# New Markdown',
            );
            $postarr = array(
                'post_type' => 'post',
            );

            try {
                $handler->render_markdown_post_content($data, $postarr);
                $this->fail('Expected new EasyMDE save to abort when the renderer is unavailable.');
            } catch (\RuntimeException $exception) {
                $this->assertStringContainsString('Markdown rendering is unavailable', $exception->getMessage());
            }
        } finally {
            $_POST = $previous_post;
            remove_filter('wp_die_handler', array($this, 'throwing_wp_die_handler'));
        }
    }

    public function test_missing_renderer_aborts_save_post_meta_before_meta_changes()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
                'post_content' => '<p>Old HTML</p>',
            )
        );

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Old Markdown');
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'default');

        wp_set_current_user($user_id);
        add_filter('wp_die_handler', array($this, 'throwing_wp_die_handler'));

        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => '# New Markdown',
            'easymde_markdown_theme' => 'orange-heart',
        );

        try {
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $this->theme_state_repository(),
                function () {
                    return false;
                }
            );

            try {
                $handler->save_post_meta($post_id, get_post($post_id), true);
                $this->fail('Expected EasyMDE meta save to abort when the renderer is unavailable.');
            } catch (\RuntimeException $exception) {
                $this->assertStringContainsString('Markdown rendering is unavailable', $exception->getMessage());
            }

            $this->assertSame('# Old Markdown', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
            $this->assertSame('default', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
            $this->assertSame('<p>Old HTML</p>', get_post($post_id)->post_content);
        } finally {
            $_POST = $previous_post;
            remove_filter('wp_die_handler', array($this, 'throwing_wp_die_handler'));
        }
    }

    public function test_existing_custom_css_snapshot_survives_save_by_editor_without_library_item()
    {
        $owner_id = self::factory()->user->create(array('role' => 'editor'));
        $editor_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $owner_id,
            )
        );

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Old Markdown');
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'custom');
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_ID, 'owner-style');
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, ':root { --brand: red; } h2 { color: var(--brand); }');

        wp_set_current_user($editor_id);

        $previous_post = $_POST;
        $_POST = array(
            'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
            'easymde_enabled' => '1',
            'easymde_markdown' => '# Updated Markdown',
            'easymde_markdown_theme' => 'custom',
            'easymde_custom_css_id' => 'owner-style',
        );

        try {
            $handler = new EditorSaveHandler(
                new PostDocument(),
                $this->theme_state_repository(),
                function () {
                    return true;
                }
            );
            $handler->save_post_meta($post_id, get_post($post_id), true);

            $this->assertSame('# Updated Markdown', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
            $this->assertSame('custom', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
            $this->assertSame('owner-style', get_post_meta($post_id, PostDocument::META_CUSTOM_CSS_ID, true));
            $this->assertSame(':root { --brand: red; } h2 { color: var(--brand); }', get_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true));
        } finally {
            $_POST = $previous_post;
        }
    }

    public function test_typora_derived_theme_save_persists_theme_and_font_defaults()
    {
        $themes = array(
            'qingbi-liujin' => array(
                'markdown' => '# Qingbi Liujin',
                'customFont' => 'qingbi-liujin-helvetica',
                'windowsFont' => 'qingbi-liujin-no-windows',
                'appleFont' => 'qingbi-liujin-no-apple',
            ),
            'qinghe-zhusha' => array(
                'markdown' => '# Qinghe Zhusha',
                'customFont' => 'qinghe-zhusha-helvetica',
                'windowsFont' => 'qinghe-zhusha-no-windows',
                'appleFont' => 'qinghe-zhusha-no-apple',
            ),
        );

        foreach ($themes as $theme_id => $expected) {
            $user_id = self::factory()->user->create(array('role' => 'editor'));
            $post_id = self::factory()->post->create(
                array(
                    'post_type' => 'post',
                    'post_author' => $user_id,
                )
            );

            wp_set_current_user($user_id);

            $previous_post = $_POST;
            $_POST = array(
                'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
                'easymde_enabled' => '1',
                'easymde_markdown' => $expected['markdown'],
                'easymde_markdown_theme' => $theme_id,
                'easymde_code_theme' => 'atom-one-dark',
                'easymde_custom_font' => 'optima',
                'easymde_windows_font' => 'microsoft-yahei',
                'easymde_apple_font' => 'pingfang-sc-light',
                'easymde_serif_font' => 'yes',
            );

            try {
                $repository = $this->theme_state_repository();
                $handler = new EditorSaveHandler(
                    new PostDocument(),
                    $repository,
                    function () {
                        return true;
                    }
                );
                $handler->save_post_meta($post_id, get_post($post_id), true);

                $this->assertSame($theme_id, get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
                $this->assertSame($expected['customFont'], get_post_meta($post_id, PostDocument::META_CUSTOM_FONT, true));
                $this->assertSame($expected['windowsFont'], get_post_meta($post_id, PostDocument::META_WINDOWS_FONT, true));
                $this->assertSame($expected['appleFont'], get_post_meta($post_id, PostDocument::META_APPLE_FONT, true));
                $this->assertSame('sans-serif-only', get_post_meta($post_id, PostDocument::META_SERIF_FONT, true));

                $state = $repository->get_theme_state($post_id);

                $this->assertSame($theme_id, $state['markdownTheme']);
                $this->assertSame($expected['customFont'], $state['customFont']);
                $this->assertSame($expected['windowsFont'], $state['windowsFont']);
                $this->assertSame($expected['appleFont'], $state['appleFont']);
                $this->assertSame('sans-serif-only', $state['serifFont']);
                $this->assertSame('Helvetica, Arial, sans-serif', $state['fontFamily']);
            } finally {
                $_POST = $previous_post;
            }
        }
    }

    public function test_valid_save_never_writes_existing_legacy_mac_frame_meta()
    {
        foreach (array('0', '1') as $legacy_value) {
            $user_id = self::factory()->user->create(array('role' => 'editor'));
            $post_id = self::factory()->post->create(
                array(
                    'post_type' => 'post',
                    'post_author' => $user_id,
                )
            );
            update_post_meta($post_id, '_easymde_code_mac_style', $legacy_value);
            wp_set_current_user($user_id);

            $events = array();
            $record_event = static function ($meta_id, $object_id, $meta_key) use (&$events, $post_id) {
                unset($meta_id);
                if ((int) $object_id === $post_id && '_easymde_code_mac_style' === $meta_key) {
                    $events[] = current_filter();
                }
            };
            add_action('added_post_meta', $record_event, 10, 3);
            add_action('updated_post_meta', $record_event, 10, 3);
            add_action('deleted_post_meta', $record_event, 10, 3);

            $previous_post = $_POST;
            $_POST = array(
                'easymde_nonce' => wp_create_nonce('easymde_save_markdown'),
                'easymde_enabled' => '1',
                'easymde_markdown' => '# Legacy value remains ' . $legacy_value,
                'easymde_markdown_theme' => 'default',
                'easymde_code_theme' => 'github-dark',
                'easymde_code_mac_style' => '1' === $legacy_value ? '0' : '1',
            );

            try {
                $handler = new EditorSaveHandler(
                    new PostDocument(),
                    $this->theme_state_repository(),
                    static function () {
                        return true;
                    }
                );
                $handler->save_post_meta($post_id, get_post($post_id), true);

                $this->assertSame($legacy_value, get_post_meta($post_id, '_easymde_code_mac_style', true));
                $this->assertSame(array(), $events);
            } finally {
                $_POST = $previous_post;
                remove_action('added_post_meta', $record_event, 10);
                remove_action('updated_post_meta', $record_event, 10);
                remove_action('deleted_post_meta', $record_event, 10);
            }
        }
    }

    public function throwing_wp_die_handler()
    {
        return array($this, 'throw_wp_die_exception');
    }

    public function throw_wp_die_exception($message)
    {
        throw new \RuntimeException(wp_strip_all_tags((string) $message));
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
