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

        $this->assertStringContainsString('<section class="table-container">', $html);
        $this->assertStringContainsString('<table>', $html);
    }

    public function test_cupid_busy_mdnice_image_width_preserves_alt_text()
    {
        $html = MarkdownRenderer::render(
            '![Logo](https://example.test/logo.png =45%x)',
            'cupid-busy'
        );

        $this->assertStringContainsString('alt="Logo"', $html);
        $this->assertStringContainsString('width="45%"', $html);
        $this->assertStringContainsString('<figcaption>Logo</figcaption>', $html);
        $this->assertStringNotContainsString('easymde-mdnice-width', $html);
    }

    public function test_cupid_busy_does_not_treat_user_alt_as_width_state()
    {
        $html = MarkdownRenderer::render(
            '![EASYMDE_MDNICE_WIDTH_50](https://example.test/image.png)',
            'cupid-busy'
        );

        $this->assertStringContainsString('alt="EASYMDE_MDNICE_WIDTH_50"', $html);
        $this->assertStringContainsString('<figcaption>EASYMDE_MDNICE_WIDTH_50</figcaption>', $html);
        $this->assertStringNotContainsString('width="50%"', $html);
    }

    public function test_reference_heading_text_does_not_stop_yamabuki_footnotes()
    {
        $html = MarkdownRenderer::render(
            "## Intro\n\n[First](https://example.test/first \"First\")\n\n## 参考资料\n\n[Second](https://example.test/second \"Second\")",
            'yamabuki'
        );

        $this->assertStringContainsString('First: <em>https://example.test/first</em>', $html);
        $this->assertStringContainsString('Second: <em>https://example.test/second</em>', $html);
        $this->assertStringNotContainsString('href="https://example.test/second"', $html);
    }

    public function test_toc_includes_user_headings_named_like_toc()
    {
        $html = MarkdownRenderer::render(
            "## 目录\n\n## TOC\n\n## Table of Contents\n\n[TOC]"
        );

        $this->assertStringContainsString('<a href="#section-1">目录</a>', $html);
        $this->assertStringContainsString('<a href="#toc">TOC</a>', $html);
        $this->assertStringContainsString('<a href="#table-of-contents">Table of Contents</a>', $html);
    }
}
