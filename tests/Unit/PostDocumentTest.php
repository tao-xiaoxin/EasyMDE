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

    public function test_regular_html_post_without_easymde_meta_imports_post_content_as_markdown()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<!-- wp:heading --><h2>Imported Heading</h2><!-- /wp:heading --><p>A <strong>bold</strong> <a href="https://example.test">link</a>.</p><ul><li>One</li><li>Two</li></ul>',
            )
        );

        $document = new PostDocument();

        $this->assertSame(
            "## Imported Heading\n\nA **bold** [link](https://example.test).\n\n- One\n- Two",
            $document->get_markdown(get_post($post_id))
        );
        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_MARKDOWN));
    }

    public function test_plain_text_with_angle_bracket_is_not_treated_as_html_import()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => 'Keep 1 < 2 as plain text.',
            )
        );

        $document = new PostDocument();

        $this->assertSame('Keep 1 < 2 as plain text.', $document->get_markdown(get_post($post_id)));
    }

    public function test_tag_like_plain_text_is_not_imported_as_html()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => 'Literal &lt;tag&gt; text stays visible.',
            )
        );

        $document = new PostDocument();

        $this->assertSame('Literal \<tag> text stays visible.', $document->get_markdown(get_post($post_id)));
    }

    public function test_imported_html_text_is_escaped_before_markdown_save()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Visible **not bold** and &lt;div&gt;.</p>',
            )
        );

        $document = new PostDocument();

        $this->assertSame('Visible \*\*not bold\*\* and \<div>.', $document->get_markdown(get_post($post_id)));
    }

    public function test_imported_inline_code_uses_a_safe_backtick_fence()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<p>Use <code>tick ` and `` runs</code>.</p>',
            )
        );

        $document = new PostDocument();

        $this->assertSame('Use ```tick ` and `` runs```.', $document->get_markdown(get_post($post_id)));
    }

    public function test_imported_pre_code_preserves_language_class()
    {
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_content' => '<pre><code class="language-mermaid">graph TD; A-->B;</code></pre>',
            )
        );

        $document = new PostDocument();

        $this->assertSame("```mermaid\ngraph TD; A-->B;\n```", $document->get_markdown(get_post($post_id)));
    }
}
