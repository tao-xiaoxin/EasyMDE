<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class FrontendAssetsTest extends WP_UnitTestCase
{
    public function test_qingbi_liujin_theme_enqueues_registered_article_stylesheet()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'qingbi-liujin');

        wp_dequeue_style('easymde-article-theme');
        wp_deregister_style('easymde-article-theme');

        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );
        $assets->enqueue_render_assets($post_id, '', false);

        $registered = wp_styles()->registered;

        $this->assertArrayHasKey('easymde-article-theme', $registered);
        $this->assertStringEndsWith(
            'assets/themes/article/qingbi-liujin.css',
            $registered['easymde-article-theme']->src
        );
        $this->assertTrue(wp_style_is('easymde-article-theme', 'enqueued'));
    }

    public function test_indented_code_blocks_request_code_assets()
    {
        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );

        $features = $assets->get_feature_config("Paragraph\n\n    echo 'hello';\n");

        $this->assertTrue($features['codeBlocks']);
        $this->assertTrue($features['syntaxHighlight']);
    }
}
