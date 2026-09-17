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

    public function test_preview_request_returns_a_line_edit_map_without_changing_the_formal_html_contract()
    {
        $controller = $this->controller();
        $request   = new WP_REST_Request('POST', '/easymde/v1/preview');
        $markdown  = "# Heading\r\n\r\nParagraph with **strong**.";
        $request->set_param('markdown', $markdown);

        $response = $controller->handle_request($request);
        $data     = $response->get_data();

        $this->assertArrayHasKey('html', $data);
        $this->assertArrayHasKey('features', $data);
        $this->assertArrayHasKey('editMap', $data);
        $this->assertSame(1, $data['editMap']['version']);
        $this->assertSame('line', $data['editMap']['coordinate']);
        $this->assertCount(2, $data['editMap']['blocks']);
        $this->assertSame(array('id', 'startLine', 'endLine', 'editable'), array_keys($data['editMap']['blocks'][0]));
        $this->assertSame('b0', $data['editMap']['blocks'][0]['id']);
        $this->assertSame(0, $data['editMap']['blocks'][0]['startLine']);
        $this->assertSame(1, $data['editMap']['blocks'][0]['endLine']);
        $this->assertSame('b1', $data['editMap']['blocks'][1]['id']);
        $this->assertSame(2, $data['editMap']['blocks'][1]['startLine']);
        $this->assertSame(3, $data['editMap']['blocks'][1]['endLine']);
        $this->assertStringContainsString('data-easymde-visual-block-id="b0"', $data['html']);
        $this->assertStringContainsString('data-easymde-visual-block-id="b1"', $data['html']);
        $this->assertStringNotContainsString('data-easymde-visual-source-id', $data['html']);
    }

    public function test_preview_request_rejects_oversized_markdown_before_rendering_or_mapping()
    {
        $controller = $this->controller();
        $request   = new WP_REST_Request('POST', '/easymde/v1/preview');
        $request->set_param('markdown', str_repeat('x', PreviewController::MAX_MARKDOWN_BYTES + 1));

        $response = $controller->handle_request($request);

        $this->assertWPError($response);
        $this->assertSame('easymde_markdown_too_large', $response->get_error_code());
        $this->assertSame(413, $response->get_error_data()['status']);
    }

    public function test_preview_mapping_failure_uses_the_existing_failure_copy_and_stable_error_contract()
    {
        $this->assertSame('easymde_preview_failed', PreviewController::PREVIEW_FAILURE_CODE);
        $this->assertSame(500, PreviewController::PREVIEW_FAILURE_STATUS);
        $this->assertSame(
            'Preview failed. Please keep writing; saving is not affected.',
            __( 'Preview failed. Please keep writing; saving is not affected.', 'easymde' )
        );
    }

    public function test_preview_route_has_no_mac_frame_argument_and_unknown_input_cannot_change_output()
    {
        $controller = $this->controller();
        add_action('rest_api_init', array($controller, 'register_routes'));
        do_action('rest_api_init');
        remove_action('rest_api_init', array($controller, 'register_routes'));
        $routes = rest_get_server()->get_routes();
        $args = $routes['/easymde/v1/preview'][0]['args'];

        $this->assertArrayNotHasKey('code_mac_style', $args);

        $without_legacy_input = new WP_REST_Request('POST', '/easymde/v1/preview');
        $without_legacy_input->set_param('markdown', "```php\necho 'fixed';\n```");
        $with_legacy_input = clone $without_legacy_input;
        $with_legacy_input->set_param('code_mac_style', false);

        $this->assertSame(
            $controller->handle_request($without_legacy_input)->get_data(),
            $controller->handle_request($with_legacy_input)->get_data()
        );
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
