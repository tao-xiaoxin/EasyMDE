<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class FrontendAssetsTest extends WP_UnitTestCase
{
    public function tear_down()
    {
        foreach (array(
            'easymde-content',
            'easymde-article-theme',
            'easymde-code-frame',
            'easymde-highlight-theme',
            'easymde-math',
            'easymde-katex',
            'easymde-toc',
        ) as $handle) {
            wp_dequeue_style($handle);
            wp_deregister_style($handle);
        }

        foreach (array(
            'easymde-enhancements',
            'easymde-highlight',
            'easymde-katex',
            'easymde-math-renderer',
            'easymde-mermaid',
            'easymde-mermaid-renderer',
        ) as $handle) {
            wp_dequeue_script($handle);
            wp_deregister_script($handle);
        }

        parent::tear_down();
    }

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
            $assets->enqueue_render_assets($post_id, '');

            $registered = wp_styles()->registered;

            $this->assertArrayHasKey('easymde-article-theme', $registered);
            $this->assertStringEndsWith($asset_path, $registered['easymde-article-theme']->src);
            $this->assertTrue(wp_style_is('easymde-article-theme', 'enqueued'));
        }
    }

    public function test_removed_builtin_theme_falls_back_to_default_article_stylesheet_on_frontend()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'md2html-normal');

        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );
        $assets->enqueue_render_assets($post_id, '# Legacy theme fallback');

        $registered = wp_styles()->registered;

        $this->assertArrayHasKey('easymde-article-theme', $registered);
        $this->assertStringEndsWith('assets/themes/article/default.css', $registered['easymde-article-theme']->src);
        $this->assertStringNotContainsString('md2html-normal.css', $registered['easymde-article-theme']->src);
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

    public function test_code_frame_assets_follow_regular_code_features_not_legacy_meta()
    {
        $repository = new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy());
        $assets = new FrontendAssets(new PostDocument(), $repository);

        foreach (array('0', '1') as $legacy_value) {
            $post_id = self::factory()->post->create(array('post_type' => 'post'));
            update_post_meta($post_id, '_easymde_code_mac_style', $legacy_value);

            $assets->enqueue_render_assets($post_id, "```php\necho 'frame';\n```");

            $this->assertTrue(wp_style_is('easymde-code-frame', 'enqueued'));
            $this->assertTrue(wp_style_is('easymde-highlight-theme', 'enqueued'));
            $this->assertSame($legacy_value, get_post_meta($post_id, '_easymde_code_mac_style', true));

            wp_dequeue_style('easymde-code-frame');
            wp_dequeue_style('easymde-highlight-theme');
        }
    }

    public function test_plain_and_mermaid_only_content_do_not_enqueue_code_frame_assets()
    {
        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );

        $assets->enqueue_render_assets(0, 'Plain paragraph');
        $this->assertFalse(wp_style_is('easymde-code-frame', 'enqueued'));
        $this->assertFalse(wp_style_is('easymde-highlight-theme', 'enqueued'));

        $assets->enqueue_render_assets(0, "```mermaid\ngraph TD; A-->B;\n```");
        $this->assertFalse(wp_style_is('easymde-code-frame', 'enqueued'));
        $this->assertFalse(wp_style_is('easymde-highlight-theme', 'enqueued'));
        $this->assertTrue(wp_script_is('easymde-mermaid', 'enqueued'));
    }

    public function test_editor_base_assets_do_not_enqueue_optional_preview_runtimes()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );

        $assets->enqueue_editor_base_assets($post_id);

        $this->assertTrue(wp_style_is('easymde-content', 'enqueued'));
        $this->assertTrue(wp_style_is('easymde-article-theme', 'enqueued'));
        $this->assertTrue(wp_script_is('easymde-enhancements', 'enqueued'));
        $this->assertFalse(wp_script_is('easymde-highlight', 'enqueued'));
        $this->assertFalse(wp_script_is('easymde-katex', 'enqueued'));
        $this->assertFalse(wp_script_is('easymde-math-renderer', 'enqueued'));
        $this->assertFalse(wp_script_is('easymde-mermaid', 'enqueued'));
        $this->assertFalse(wp_script_is('easymde-mermaid-renderer', 'enqueued'));
        $this->assertSame(array(), wp_scripts()->registered['easymde-enhancements']->deps);
    }

    public function test_combined_render_assets_are_local_and_enqueued_once()
    {
        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );
        $markdown = "```php\necho 'hello';\n```\n\nInline \$a+b\$.\n\n```mermaid\ngraph TD; A-->B;\n```";

        $assets->enqueue_render_assets(0, $markdown);
        $assets->enqueue_render_assets(0, $markdown);

        $expected_scripts = array(
            'easymde-highlight' => 'assets/vendor/highlight/highlight.min.js',
            'easymde-katex' => 'assets/vendor/katex/katex.min.js',
            'easymde-math-renderer' => 'assets/js/frontend/math.js',
            'easymde-mermaid' => 'assets/vendor/mermaid/mermaid.min.js',
            'easymde-mermaid-renderer' => 'assets/js/frontend/mermaid.js',
        );
        $expected_styles = array(
            'easymde-code-frame' => 'assets/css/frontend/code-frame.css',
            'easymde-highlight-theme' => 'assets/vendor/highlight/styles/github.min.css',
            'easymde-math' => 'assets/css/frontend/math.css',
            'easymde-katex' => 'assets/vendor/katex/katex.min.css',
        );

        foreach ($expected_scripts as $handle => $path) {
            $this->assertTrue(wp_script_is($handle, 'enqueued'));
            $this->assertStringEndsWith($path, wp_scripts()->registered[$handle]->src);
            $this->assertSame(1, count(array_keys(wp_scripts()->queue, $handle, true)));
        }

        foreach ($expected_styles as $handle => $path) {
            $this->assertTrue(wp_style_is($handle, 'enqueued'));
            $this->assertStringEndsWith($path, wp_styles()->registered[$handle]->src);
            $this->assertSame(1, count(array_keys(wp_styles()->queue, $handle, true)));
        }
    }

    public function test_feature_manifest_distinguishes_plain_code_math_and_mermaid()
    {
        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );

        $plain = $assets->get_feature_config('Plain paragraph');
        $code = $assets->get_feature_config("```php\necho 'hello';\n```");
        $math = $assets->get_feature_config('Inline $a+b$ value');
        $mermaid = $assets->get_feature_config("```mermaid\ngraph TD; A-->B;\n```");
        $tilde_mermaid = $assets->get_feature_config("~~~ mermaid\ngraph TD; A-->B;\n~~~");
        $indented_mermaid_example = $assets->get_feature_config("    ```mermaid\n    graph TD; A-->B;\n    ```");
        $tab_indented_mermaid_example = $assets->get_feature_config("\t```mermaid\n\tgraph TD; A-->B;\n\t```");
        $blockquote_mermaid = $assets->get_feature_config("> ```mermaid\n> graph TD; A-->B;\n> ```");

        $this->assertFalse($plain['syntaxHighlight']);
        $this->assertFalse($plain['math']);
        $this->assertFalse($plain['mermaid']);
        $this->assertTrue($code['codeBlocks']);
        $this->assertTrue($code['syntaxHighlight']);
        $this->assertTrue($math['math']);
        $this->assertTrue($mermaid['codeBlocks']);
        $this->assertTrue($mermaid['mermaid']);
        $this->assertFalse($mermaid['syntaxHighlight']);
        $this->assertTrue($tilde_mermaid['codeBlocks']);
        $this->assertTrue($tilde_mermaid['mermaid']);
        $this->assertFalse($tilde_mermaid['syntaxHighlight']);
        $this->assertTrue($indented_mermaid_example['codeBlocks']);
        $this->assertTrue($indented_mermaid_example['syntaxHighlight']);
        $this->assertFalse($indented_mermaid_example['mermaid']);
        $this->assertTrue($tab_indented_mermaid_example['codeBlocks']);
        $this->assertTrue($tab_indented_mermaid_example['syntaxHighlight']);
        $this->assertFalse($tab_indented_mermaid_example['mermaid']);
        $this->assertTrue($blockquote_mermaid['codeBlocks']);
        $this->assertTrue($blockquote_mermaid['mermaid']);
        $this->assertFalse($blockquote_mermaid['syntaxHighlight']);
    }
}
