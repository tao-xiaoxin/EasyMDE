<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Content\RevisionManager;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class RevisionManagerTest extends WP_UnitTestCase
{
    public function test_restore_revision_meta_regenerates_post_content_from_restored_markdown()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Current</p>',
            )
        );
        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
                'post_content' => '<p>Old</p>',
            )
        );

        update_metadata('post', $revision_id, PostDocument::META_ENABLED, '1');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN, '# Restored');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN_THEME, 'custom');
        update_metadata('post', $revision_id, PostDocument::META_CODE_THEME, 'monokai');
        update_metadata('post', $revision_id, PostDocument::META_CODE_MAC_STYLE, '1');
        update_metadata('post', $revision_id, PostDocument::META_CUSTOM_CSS_ID, 'revision-style');
        update_metadata('post', $revision_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, 'h2 { color: red; }');
        update_metadata('post', $revision_id, PostDocument::META_CUSTOM_FONT, 'georgia');
        update_metadata('post', $revision_id, PostDocument::META_WINDOWS_FONT, 'microsoft-yahei');
        update_metadata('post', $revision_id, PostDocument::META_APPLE_FONT, 'pingfang-sc-regular');
        update_metadata('post', $revision_id, PostDocument::META_SERIF_FONT, 'serif-only');

        $repository = new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
        $manager = new RevisionManager(new PostDocument(), $repository);
        $manager->restore_revision_meta($post_id, $revision_id);

        $this->assertSame('1', get_post_meta($post_id, PostDocument::META_ENABLED, true));
        $this->assertSame('# Restored', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
        $this->assertSame('custom', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
        $this->assertSame('monokai', get_post_meta($post_id, PostDocument::META_CODE_THEME, true));
        $this->assertSame('1', get_post_meta($post_id, PostDocument::META_CODE_MAC_STYLE, true));
        $this->assertSame('revision-style', get_post_meta($post_id, PostDocument::META_CUSTOM_CSS_ID, true));
        $this->assertSame('h2 { color: red; }', get_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true));
        $this->assertSame('georgia', get_post_meta($post_id, PostDocument::META_CUSTOM_FONT, true));
        $this->assertSame('microsoft-yahei', get_post_meta($post_id, PostDocument::META_WINDOWS_FONT, true));
        $this->assertSame('pingfang-sc-regular', get_post_meta($post_id, PostDocument::META_APPLE_FONT, true));
        $this->assertSame('serif-only', get_post_meta($post_id, PostDocument::META_SERIF_FONT, true));
        $this->assertStringContainsString('Restored', get_post($post_id)->post_content);
        $this->assertStringNotContainsString('Current', get_post($post_id)->post_content);
    }

    public function test_restore_revision_meta_restores_font_settings()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
            )
        );

        update_metadata('post', $revision_id, PostDocument::META_ENABLED, '1');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN, '# Restored');
        update_metadata('post', $revision_id, PostDocument::META_CUSTOM_FONT, 'georgia');
        update_metadata('post', $revision_id, PostDocument::META_WINDOWS_FONT, 'microsoft-yahei');
        update_metadata('post', $revision_id, PostDocument::META_APPLE_FONT, 'pingfang-sc-regular');
        update_metadata('post', $revision_id, PostDocument::META_SERIF_FONT, 'serif-only');

        $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
        $manager->restore_revision_meta($post_id, $revision_id);

        $this->assertSame('georgia', get_post_meta($post_id, PostDocument::META_CUSTOM_FONT, true));
        $this->assertSame('pingfang-sc-regular', get_post_meta($post_id, PostDocument::META_APPLE_FONT, true));
        $this->assertSame('serif-only', get_post_meta($post_id, PostDocument::META_SERIF_FONT, true));
    }

    public function test_restore_revision_meta_uses_revision_content_when_renderer_unavailable()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Current HTML</p>',
            )
        );
        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
                'post_content' => '<p>Revision HTML</p>',
            )
        );

        update_metadata('post', $revision_id, PostDocument::META_ENABLED, '1');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN, '# Restored while unavailable');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN_THEME, 'default');
        update_metadata('post', $revision_id, PostDocument::META_CODE_THEME, 'github-dark');
        update_metadata('post', $revision_id, PostDocument::META_CODE_MAC_STYLE, '0');
        update_metadata('post', $revision_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, 'p { color: blue; }');

        $manager = new RevisionManager(
            new PostDocument(),
            $this->theme_state_repository(),
            function () {
                return false;
            }
        );
        $manager->restore_revision_meta($post_id, $revision_id);

        $this->assertSame('1', get_post_meta($post_id, PostDocument::META_ENABLED, true));
        $this->assertSame('# Restored while unavailable', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
        $this->assertSame('default', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
        $this->assertSame('github-dark', get_post_meta($post_id, PostDocument::META_CODE_THEME, true));
        $this->assertSame('0', get_post_meta($post_id, PostDocument::META_CODE_MAC_STYLE, true));
        $this->assertSame('p { color: blue; }', get_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true));
        $this->assertSame('<p>Revision HTML</p>', get_post($post_id)->post_content);
    }

    public function test_restore_pre_easymde_revision_clears_markdown_state_and_restores_revision_content()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Rendered current Markdown</p>',
            )
        );
        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Pre EasyMDE revision',
                'post_content' => '<p>Original HTML revision</p>',
            )
        );

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Current Markdown');
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'custom');
        update_post_meta($post_id, PostDocument::META_CODE_THEME, 'monokai');
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, 'h2 { color: red; }');

        $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
        $manager->restore_revision_meta($post_id, $revision_id);

        foreach ((new PostDocument())->revision_meta_keys() as $key) {
            $this->assertFalse(metadata_exists('post', $post_id, $key), $key);
        }
        $this->assertSame('<p>Original HTML revision</p>', get_post($post_id)->post_content);
        $this->assertFalse((new PostDocument())->is_easymde_post($post_id));
    }

    public function test_restore_revision_meta_does_not_clean_cache_when_post_content_update_fails()
    {
        global $wpdb;

        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Current HTML</p>',
            )
        );
        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
                'post_content' => '<p>Revision HTML</p>',
            )
        );

        update_metadata('post', $revision_id, PostDocument::META_ENABLED, '1');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN, '# Restored');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN_THEME, 'orange-heart');

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Current Markdown');
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'default');

        $cleaned_post_cache = false;
        $restore_failure = null;
        $clean_cache_listener = function ($cleaned_post_id) use ($post_id, &$cleaned_post_cache) {
            if ((int) $post_id === (int) $cleaned_post_id) {
                $cleaned_post_cache = true;
            }
        };
        $restore_failure_listener = function ($failed_post_id, $failed_revision_id, $exception) use ($post_id, $revision_id, &$restore_failure) {
            $restore_failure = array($failed_post_id, $failed_revision_id, $exception);
        };
        $fail_post_content_update = function ($query) use ($wpdb) {
            if (false !== strpos($query, 'UPDATE `' . $wpdb->posts . '`') && false !== strpos($query, '`post_content`')) {
                return false;
            }

            return $query;
        };
        add_action('clean_post_cache', $clean_cache_listener, 10, 1);
        add_action('easymde_revision_restore_failed', $restore_failure_listener, 10, 3);
        add_filter('query', $fail_post_content_update);

        try {
            $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
            $manager->restore_revision_meta($post_id, $revision_id);
        } finally {
            remove_filter('query', $fail_post_content_update);
            remove_action('easymde_revision_restore_failed', $restore_failure_listener, 10);
            remove_action('clean_post_cache', $clean_cache_listener, 10);
        }

        $this->assertFalse($cleaned_post_cache);
        $this->assertIsArray($restore_failure);
        $this->assertSame($post_id, $restore_failure[0]);
        $this->assertSame($revision_id, $restore_failure[1]);
        $this->assertInstanceOf(\RuntimeException::class, $restore_failure[2]);
        $this->assertSame('1', get_post_meta($post_id, PostDocument::META_ENABLED, true));
        $this->assertSame('# Current Markdown', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
        $this->assertSame('default', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
        $this->assertSame('<p>Current HTML</p>', get_post($post_id)->post_content);
    }

    public function test_wp_restore_revision_keeps_core_restored_content_and_meta_aligned_when_direct_update_fails()
    {
        global $wpdb;

        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Current HTML</p>',
            )
        );
        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
                'post_content' => '<p>Revision HTML</p>',
            )
        );

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Current Markdown');
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'default');

        update_metadata('post', $revision_id, PostDocument::META_ENABLED, '1');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN, '# Revision Markdown');
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN_THEME, 'orange-heart');

        $restore_failure = null;
        $restore_failure_listener = function ($failed_post_id, $failed_revision_id, $exception) use ($post_id, $revision_id, &$restore_failure) {
            $restore_failure = array($failed_post_id, $failed_revision_id, $exception);
        };
        $fail_easymde_post_content_update = function ($query) use ($wpdb) {
            if (
                doing_action('wp_restore_post_revision')
                && false !== strpos($query, 'UPDATE `' . $wpdb->posts . '`')
                && false !== strpos($query, '`post_content`')
            ) {
                return false;
            }

            return $query;
        };
        add_action('easymde_revision_restore_failed', $restore_failure_listener, 10, 3);
        add_filter('query', $fail_easymde_post_content_update);

        try {
            $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
            add_action('wp_restore_post_revision', array($manager, 'restore_revision_meta'), 10, 2);
            wp_restore_post_revision($revision_id);
        } finally {
            remove_action('wp_restore_post_revision', array($manager, 'restore_revision_meta'), 10);
            remove_filter('query', $fail_easymde_post_content_update);
            remove_action('easymde_revision_restore_failed', $restore_failure_listener, 10);
        }

        $this->assertIsArray($restore_failure);
        $this->assertSame($post_id, $restore_failure[0]);
        $this->assertSame($revision_id, $restore_failure[1]);
        $this->assertInstanceOf(\RuntimeException::class, $restore_failure[2]);
        $this->assertSame('1', get_post_meta($post_id, PostDocument::META_ENABLED, true));
        $this->assertSame('# Revision Markdown', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
        $this->assertSame('orange-heart', get_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, true));
        $this->assertSame('<p>Revision HTML</p>', get_post($post_id)->post_content);
    }

    public function test_sync_latest_revision_meta_after_save_uses_current_parent_meta()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Old');

        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
            )
        );

        $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
        $manager->save_revision_meta($revision_id);

        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# New');
        $manager->sync_latest_revision_meta_after_save($post_id, get_post($post_id), true);

        $this->assertSame('# New', get_post_meta($revision_id, PostDocument::META_MARKDOWN, true));
    }

    public function test_sync_latest_revision_meta_after_save_uses_newest_revision_id()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Current parent');

        $older_revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Older revision',
                'post_date' => '2026-01-01 00:00:02',
                'post_date_gmt' => '2026-01-01 00:00:02',
            )
        );
        update_metadata('post', $older_revision_id, PostDocument::META_MARKDOWN, '# Older revision meta');

        $newer_revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Newest revision',
                'post_date' => '2026-01-01 00:00:01',
                'post_date_gmt' => '2026-01-01 00:00:01',
            )
        );
        update_metadata('post', $newer_revision_id, PostDocument::META_MARKDOWN, '# Newer revision meta');

        $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
        $manager->sync_latest_revision_meta_after_save($post_id, get_post($post_id), true);

        $this->assertSame('# Older revision meta', get_post_meta($older_revision_id, PostDocument::META_MARKDOWN, true));
        $this->assertSame('# Current parent', get_post_meta($newer_revision_id, PostDocument::META_MARKDOWN, true));
    }

    public function test_save_revision_meta_copies_all_easymde_revision_fields()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Snapshot');
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'orange-heart');
        update_post_meta($post_id, PostDocument::META_CODE_THEME, 'xcode');
        update_post_meta($post_id, PostDocument::META_CODE_MAC_STYLE, '1');
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_ID, 'snapshot-css');
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, 'h3 { color: green; }');
        update_post_meta($post_id, PostDocument::META_CUSTOM_FONT, 'georgia');
        update_post_meta($post_id, PostDocument::META_WINDOWS_FONT, 'microsoft-yahei');
        update_post_meta($post_id, PostDocument::META_APPLE_FONT, 'pingfang-sc-light');
        update_post_meta($post_id, PostDocument::META_SERIF_FONT, 'serif-only');

        $revision_id = wp_insert_post(
            array(
                'post_parent' => $post_id,
                'post_type' => 'revision',
                'post_status' => 'inherit',
                'post_title' => 'Revision',
            )
        );

        $manager = new RevisionManager(new PostDocument(), $this->theme_state_repository());
        $manager->save_revision_meta($revision_id);

        foreach ((new PostDocument())->revision_meta_keys() as $key) {
            $this->assertSame(get_post_meta($post_id, $key, true), get_post_meta($revision_id, $key, true), $key);
        }
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
