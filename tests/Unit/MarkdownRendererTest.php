<?php

use EasyMDE\Content\MarkdownRenderer;

final class MarkdownRendererTest extends WP_UnitTestCase
{
    public function test_renders_basic_markdown_with_commonmark()
    {
        $html = MarkdownRenderer::render("# Hello\n\n**World**");

        $this->assertStringContainsString('<h1', $html);
        $this->assertStringContainsString('<strong>World</strong>', $html);
    }

    public function test_strips_untrusted_html()
    {
        $html = MarkdownRenderer::render("<script>alert(\"x\")</script>\n\n**safe**");

        $this->assertStringNotContainsString('<script', $html);
        $this->assertStringContainsString('<strong>safe</strong>', $html);
    }

    public function test_blocks_dangerous_urls_and_event_attributes()
    {
        $html = MarkdownRenderer::render(
            "[bad link](javascript:alert(1))\n\n" .
            '<img src="x" onerror="alert(1)">'
        );

        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringNotContainsString('onerror', $html);
        $this->assertStringNotContainsString('<script', $html);
    }

    public function test_keeps_expected_gfm_markdown_output()
    {
        $html = MarkdownRenderer::render(
            "![Alt text](https://example.test/image.png)\n\n" .
            "[Example](https://example.test)\n\n" .
            "| Name | Value |\n| --- | --- |\n| One | `code` |\n\n" .
            "```php\n<?php echo 'ok';\n```"
        );

        $this->assertStringContainsString('<img', $html);
        $this->assertStringContainsString('src="https://example.test/image.png"', $html);
        $this->assertStringContainsString('<a href="https://example.test">Example</a>', $html);
        $this->assertStringContainsString('<table>', $html);
        $this->assertStringContainsString('<code', $html);
    }

    public function test_yamabuki_wraps_tables_for_mobile_overflow()
    {
        $html = MarkdownRenderer::render(
            "| Name | Email | Phone |\n| --- | --- | --- |\n| 小可爱 | lovely@test.com | 18812345678 |",
            'yamabuki'
        );

        $this->assertStringContainsString('<div class="table-container">', $html);
        $this->assertStringContainsString('<table>', $html);
    }

    public function test_yamabuki_localizes_mdnice_sample_images()
    {
        $html = MarkdownRenderer::render(
            "![logo](https://files.mdnice.com/logo.svg)\n\n" .
            "![sample](https://files.mdnice.com/pic/cd3ca20c-896f-4cfc-9bdd-c4c58e69ba26.jpg)\n\n" .
            "![sized](https://files.mdnice.com/logo.png)\n\n" .
            "![external](https://example.test/image.jpg)",
            'yamabuki'
        );

        $this->assertStringContainsString('assets/images/yamabuki/logo.svg', $html);
        $this->assertStringContainsString('assets/images/yamabuki/sample-article.jpg', $html);
        $this->assertStringContainsString('https://example.test/image.jpg', $html);
        $this->assertStringNotContainsString('https://files.mdnice.com/logo.svg', $html);
        $this->assertStringNotContainsString('https://files.mdnice.com/pic/cd3ca20c-896f-4cfc-9bdd-c4c58e69ba26.jpg', $html);
        $this->assertStringNotContainsString('https://files.mdnice.com/logo.png', $html);
    }
}
