<?php

use EasyMDE\Content\PostDocument;

final class PostDocumentTest extends WP_UnitTestCase
{
    public function test_legacy_markdown_meta_enables_easymde_even_when_empty()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        add_post_meta($post_id, PostDocument::META_MARKDOWN, '');

        $document = new PostDocument();

        $this->assertTrue($document->is_easymde_post($post_id));
    }

    public function test_regular_post_without_easymde_meta_is_not_enabled()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        $document = new PostDocument();

        $this->assertFalse($document->is_easymde_post($post_id));
    }
}
