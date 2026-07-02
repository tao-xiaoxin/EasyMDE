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
}
