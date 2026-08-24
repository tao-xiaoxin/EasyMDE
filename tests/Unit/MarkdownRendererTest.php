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

    public function test_rejects_raw_html_and_dangerous_urls()
    {
        $html = MarkdownRenderer::render(
            "[bad link](javascript:alert(1))\n\n" .
            '<details open onclick="alert(1)"><summary>Safe label</summary>' .
            '<script>alert("x")</script><img src="x" onerror="alert(1)"></details>' .
            "\n\n**safe Markdown**"
        );

        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringNotContainsString('onclick', $html);
        $this->assertStringNotContainsString('onerror', $html);
        $this->assertStringNotContainsString('<script', $html);
        $this->assertStringNotContainsString('<details', $html);
        $this->assertStringNotContainsString('<summary', $html);
        $this->assertStringNotContainsString('Safe label', $html);
        $this->assertStringContainsString('<strong>safe Markdown</strong>', $html);
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

    public function test_default_renderer_supports_built_in_markdown_features_without_settings()
    {
        $html = MarkdownRenderer::render(
            "[TOC]\n\n" .
            "## Built In Features\n\n" .
            "| Name | State |\n| --- | --- |\n| Table | Ready |\n\n" .
            "- [ ] Pending\n\n" .
            '$x + y$'
        );

        $this->assertStringContainsString('<div class="easymde-toc">', $html);
        $this->assertStringContainsString('<a href="#built-in-features">Built In Features</a>', $html);
        $this->assertStringContainsString('<h2 id="built-in-features">Built In Features</h2>', $html);
        $this->assertStringContainsString('<table>', $html);
        $this->assertStringContainsString('<input disabled type="checkbox">', $html);
        $this->assertStringContainsString('<span class="easymde-math easymde-math-inline">\(x + y\)</span>', $html);
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

        $this->assertStringContainsString('<section class="table-container easymde-table-container"><table>', $html);
        $this->assertSame( 1, substr_count( $html, '<section class="table-container easymde-table-container">' ) );
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

        $this->assertStringContainsString('<section class="table-container easymde-table-container"><table>', $html);
        $this->assertSame( 1, substr_count( $html, '<section class="table-container easymde-table-container">' ) );
        $this->assertStringContainsString('<figure><img', $html);
        $this->assertStringContainsString('src="https://example.test/qinghe.png"', $html);
        $this->assertStringContainsString('alt="Qinghe caption"', $html);
        $this->assertStringContainsString('<figcaption>Qinghe caption</figcaption>', $html);
        $this->assertStringContainsString('<a href="https://example.test">Example</a>', $html);
        $this->assertStringNotContainsString('class="prefix"', $html);
        $this->assertStringNotContainsString('class="content"', $html);
        $this->assertStringNotContainsString('class="footnote-ref"', $html);
    }

    public function test_crimson_focus_wraps_tables_and_images_for_narrow_preview_surfaces()
    {
        $html = MarkdownRenderer::render(
            "![Crimson caption](https://example.test/crimson.png)\n\n" .
            "| Name | Value |\n| --- | --- |\n| One | Two |",
            'crimson-focus'
        );

        $this->assertStringContainsString('<section class="table-container easymde-table-container"><table>', $html);
        $this->assertSame( 1, substr_count( $html, '<section class="table-container easymde-table-container">' ) );
        $this->assertStringNotContainsString('<table>', str_replace('<section class="table-container easymde-table-container"><table>', '', $html));
        $this->assertStringContainsString('<figure><img', $html);
        $this->assertStringContainsString('<figcaption>Crimson caption</figcaption>', $html);
    }

    public function test_wraps_bare_tables_once_with_both_compatibility_classes()
    {
        $html = MarkdownRenderer::render(
            "| Name | Value |\n| --- | --- |\n| One | Two |",
            'default'
        );

        $this->assertSame( 1, substr_count( $html, '<section class="table-container easymde-table-container">' ) );
        $this->assertSame( 1, substr_count( $html, '<table>' ) );
        $this->assertStringNotContainsString('<section class="table-container"><table>', $html);
        $this->assertStringNotContainsString('<section class="easymde-table-container"><table>', $html);
    }

    public function test_crimson_focus_marks_task_lists_for_theme_css_fallback()
    {
        $mixed = MarkdownRenderer::render(
            "- [ ] Todo\n- Plain item",
            'crimson-focus'
        );
        $this->assertStringContainsString('<ul class="contains-task-list">', $mixed);
        $this->assertStringContainsString('<li class="task-list-item"><input', $mixed);
        $this->assertStringContainsString('type="checkbox"', $mixed);
        $this->assertStringContainsString('Plain item', $mixed);
        $this->assertStringNotContainsString('onclick=', $mixed);

        $loose_mixed = MarkdownRenderer::render(
            "- [ ] Todo\n\n- Plain item",
            'crimson-focus'
        );
        $this->assertStringContainsString('<ul class="contains-task-list">', $loose_mixed);
        $this->assertStringContainsString('<li class="task-list-item">', $loose_mixed);
        $this->assertStringContainsString('<p><input', $loose_mixed);
        $this->assertStringContainsString('Todo</p>', $loose_mixed);

        $all_tasks = MarkdownRenderer::render(
            "- [ ] Todo\n- [x] Done",
            'crimson-focus'
        );
        $this->assertStringContainsString('<ul class="task-list">', $all_tasks);
        $this->assertSame( 2, substr_count( $all_tasks, 'class="task-list-item"' ) );
        $this->assertStringContainsString('<input checked disabled type="checkbox">', $all_tasks);
    }

    public function test_task_list_markup_is_preserved_for_the_default_article_theme()
    {
        $html = MarkdownRenderer::render(
            "- [ ] Todo\n- [x] Done",
            'default'
        );

        $this->assertStringContainsString('<ul class="task-list">', $html);
        $this->assertSame( 2, substr_count( $html, 'class="task-list-item"' ) );
        $this->assertStringContainsString('<input disabled type="checkbox">', $html);
        $this->assertStringContainsString('<input checked disabled type="checkbox">', $html);
        $this->assertStringNotContainsString('onclick=', $html);
    }

    public function test_preserves_utf8_text_in_an_unordered_task_list()
    {
        $html = MarkdownRenderer::render(
            "- [ ] 待处理事项\n- [x] 已完成事项",
            'default'
        );

        $this->assertStringContainsString('待处理事项', $html);
        $this->assertStringContainsString('已完成事项', $html);
        $this->assertStringNotContainsString('å¾', $html);
        $this->assertStringNotContainsString('<?xml', $html);
        $this->assertSame( 2, substr_count( $html, 'type="checkbox"' ) );
    }

    public function test_preserves_ordered_task_list_checkboxes_and_utf8_text()
    {
        $html = MarkdownRenderer::render(
            "1. [ ] 第一项待办\n2. [x] 第二项完成",
            'default'
        );

        $this->assertStringContainsString('<ol class="task-list">', $html);
        $this->assertStringContainsString('第一项待办', $html);
        $this->assertStringContainsString('第二项完成', $html);
        $this->assertStringContainsString('<input disabled type="checkbox">', $html);
        $this->assertStringContainsString('<input checked disabled type="checkbox">', $html);
        $this->assertStringNotContainsString('<?xml', $html);
        $this->assertSame( 2, substr_count( $html, 'type="checkbox"' ) );
    }

    public function test_still_strips_a_raw_disabled_checkbox_next_to_utf8_text()
    {
        $html = MarkdownRenderer::render('保留中文 <input type="checkbox" disabled> 但删除控件');

        $this->assertStringContainsString('保留中文', $html);
        $this->assertStringContainsString('但删除控件', $html);
        $this->assertStringNotContainsString('<input', $html);
    }

    public function test_strips_raw_interactive_inputs_but_keeps_generated_task_checkboxes()
    {
        $raw_html = MarkdownRenderer::render(
            '<input type="text">' .
            '<input type="checkbox">' .
            '<input type="checkbox" checked>'
        );
        $tasks = MarkdownRenderer::render("- [ ] Todo\n- [x] Done");

        $this->assertStringNotContainsString('<input', $raw_html);
        $this->assertStringContainsString('<input disabled type="checkbox">', $tasks);
        $this->assertStringContainsString('<input checked disabled type="checkbox">', $tasks);
    }

    public function test_does_not_treat_a_class_value_as_a_disabled_checkbox_attribute()
    {
        $html = MarkdownRenderer::render('<input type="checkbox" class="disabled">');

        $this->assertStringNotContainsString('<input', $html);
    }

    public function test_strips_raw_disabled_checkbox_outside_a_task_list()
    {
        $html = MarkdownRenderer::render(
            '<input type="checkbox" disabled>' .
            '<ul><li><input type="checkbox" disabled></li></ul>'
        );

        $this->assertStringNotContainsString('<input', $html);
    }

    public function test_does_not_treat_a_class_value_as_a_checked_checkbox_attribute()
    {
        $html = MarkdownRenderer::render('<input type="checkbox" class="checked" disabled>');

        $this->assertStringNotContainsString('<input', $html);
    }

    public function test_strips_raw_form_controls_from_rendered_markdown()
    {
        $html = MarkdownRenderer::render(
            '<form action="/submit"><fieldset>' .
            '<input type="text"><button>Submit</button>' .
            '<select><option>One</option></select><textarea>Draft</textarea>' .
            '</fieldset></form><input type="checkbox">'
        );

        $this->assertStringNotContainsString('<form', $html);
        $this->assertStringNotContainsString('<fieldset', $html);
        $this->assertStringNotContainsString('<input', $html);
        $this->assertStringNotContainsString('<button', $html);
        $this->assertStringNotContainsString('<select', $html);
        $this->assertStringNotContainsString('<textarea', $html);
    }
}
