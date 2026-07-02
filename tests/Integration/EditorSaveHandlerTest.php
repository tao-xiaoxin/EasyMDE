<?php

use EasyMDE\Admin\EditorSaveHandler;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class EditorSaveHandlerTest extends WP_UnitTestCase
{
    public function test_new_post_nonce_does_not_mark_existing_ordinary_post_enabled()
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
            'easymde_nonce' => wp_create_nonce('easymde_new_post'),
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
