<?php

use EasyMDE\Rest\PreviewController;
use EasyMDE\Support\Capabilities;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class PreviewControllerTest extends WP_UnitTestCase
{
    public function test_preview_request_with_removed_builtin_theme_falls_back_to_default_markup()
    {
        $controller = $this->controller();
        $request = new WP_REST_Request('POST', '/easymde/v1/preview');
        $request->set_param('markdown', "# Heading\n\n[Link](https://example.test)");
        $request->set_param('markdown_theme', 'md2html-normal');

        $response = $controller->handle_request($request);
        $data = $response->get_data();

        $this->assertStringContainsString('<h1', $data['html']);
        $this->assertStringNotContainsString('class="prefix"', $data['html']);
        $this->assertStringNotContainsString('<span class="content">', $data['html']);
    }

    public function test_preview_request_uses_third_party_md2html_normal_registration_when_available()
    {
        $callback = static function ($themes) {
            $themes['md2html-normal'] = array(
                'id' => 'md2html-normal',
                'label' => 'Third-party Markdown2Html',
                'asset_path' => 'assets/themes/article/third-party-md2html-normal.css',
                'origin' => 'extension',
                'class_name' => 'easymde-markdown-theme-md2html-normal',
            );

            return $themes;
        };

        add_filter('easymde_article_themes', $callback);

        try {
            $controller = $this->controller();
            $request = new WP_REST_Request('POST', '/easymde/v1/preview');
            $request->set_param('markdown', "# Heading\n\n[Link](https://example.test)");
            $request->set_param('markdown_theme', 'md2html-normal');

            $response = $controller->handle_request($request);
            $data = $response->get_data();

            $this->assertStringContainsString('class="prefix"', $data['html']);
            $this->assertStringContainsString('<span class="content">Heading</span>', $data['html']);
        } finally {
            remove_filter('easymde_article_themes', $callback);
        }
    }

    private function controller()
    {
        return new PreviewController(
            new Capabilities(),
            new ThemeStateRepository(
                new ArticleThemeRegistry(),
                new CodeThemeRegistry(),
                new CustomCssPolicy()
            )
        );
    }
}
