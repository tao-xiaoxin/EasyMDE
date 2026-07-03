<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class FrontendAssetsTest extends WP_UnitTestCase
{
    public function test_typora_derived_themes_enqueue_registered_article_stylesheet()
    {
        $themes = array(
            'qingbi-liujin' => 'assets/themes/article/qingbi-liujin.css',
            'qinghe-zhusha' => 'assets/themes/article/qinghe-zhusha.css',
        );

        foreach ($themes as $theme_id => $asset_path) {
            $post_id = self::factory()->post->create(array('post_type' => 'post'));
            update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, $theme_id);

            wp_dequeue_style('easymde-article-theme');
            wp_deregister_style('easymde-article-theme');

            $assets = new FrontendAssets(
                new PostDocument(),
                new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
            );
            $assets->enqueue_render_assets($post_id, '', false);

            $registered = wp_styles()->registered;

            $this->assertArrayHasKey('easymde-article-theme', $registered);
            $this->assertStringEndsWith($asset_path, $registered['easymde-article-theme']->src);
            $this->assertTrue(wp_style_is('easymde-article-theme', 'enqueued'));
        }
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
