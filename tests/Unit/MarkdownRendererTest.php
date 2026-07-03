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

    public function test_qingbi_liujin_wraps_tables_and_images_without_mdnice_markup()
    {
        $html = MarkdownRenderer::render(
            "# Title\n\n" .
            "![Qingbi caption](https://example.test/qingbi.png)\n\n" .
            "[Example](https://example.test)\n\n" .
            "| Name | Value |\n| --- | --- |\n| One | Two |",
            'qingbi-liujin'
        );

        $this->assertStringContainsString('<section class="table-container"><table>', $html);
        $this->assertStringNotContainsString('<section class="easymde-table-container"><table>', $html);
        $this->assertStringContainsString('<figure><img', $html);
        $this->assertStringContainsString('src="https://example.test/qingbi.png"', $html);
        $this->assertStringContainsString('alt="Qingbi caption"', $html);
        $this->assertStringContainsString('<figcaption>Qingbi caption</figcaption>', $html);
        $this->assertStringContainsString('<a href="https://example.test">Example</a>', $html);
        $this->assertStringNotContainsString('class="prefix"', $html);
        $this->assertStringNotContainsString('class="content"', $html);
        $this->assertStringNotContainsString('class="footnote-ref"', $html);
    }

    public function test_qinghe_zhusha_wraps_tables_and_images_without_mdnice_markup()
    {
        $html = MarkdownRenderer::render(
            "# Title\n\n" .
            "![Qinghe caption](https://example.test/qinghe.png)\n\n" .
            "[Example](https://example.test)\n\n" .
            "| Name | Value |\n| --- | --- |\n| One | Two |",
            'qinghe-zhusha'
        );

        $this->assertStringContainsString('<section class="easymde-table-container"><table>', $html);
        $this->assertStringNotContainsString('<section class="table-container"><table>', $html);
        $this->assertStringContainsString('<figure><img', $html);
        $this->assertStringContainsString('src="https://example.test/qinghe.png"', $html);
        $this->assertStringContainsString('alt="Qinghe caption"', $html);
        $this->assertStringContainsString('<figcaption>Qinghe caption</figcaption>', $html);
        $this->assertStringContainsString('<a href="https://example.test">Example</a>', $html);
        $this->assertStringNotContainsString('class="prefix"', $html);
        $this->assertStringNotContainsString('class="content"', $html);
        $this->assertStringNotContainsString('class="footnote-ref"', $html);
    }
}
