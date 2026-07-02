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
        update_metadata('post', $revision_id, PostDocument::META_MARKDOWN_THEME, 'default');
        update_metadata('post', $revision_id, PostDocument::META_CODE_THEME, 'github');
        update_metadata('post', $revision_id, PostDocument::META_CODE_MAC_STYLE, '1');

        $repository = new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
        $manager = new RevisionManager(new PostDocument(), $repository);
        $manager->restore_revision_meta($post_id, $revision_id);

        $this->assertSame('# Restored', get_post_meta($post_id, PostDocument::META_MARKDOWN, true));
        $this->assertStringContainsString('Restored', get_post($post_id)->post_content);
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

    private function theme_state_repository()
    {
        return new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
    }
}
