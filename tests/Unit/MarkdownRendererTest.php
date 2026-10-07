<?php

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\VisualPreviewBlockAnnotator;

final class MarkdownRendererTest extends WP_UnitTestCase
{
	public function test_preview_source_map_join_failure_is_stable_and_does_not_include_document_details()
	{
		$method = new ReflectionMethod( MarkdownRenderer::class, 'append_mapped_piece' );
		$method->setAccessible( true );
		$output     = 'existing document text';
		$output_map = array();

		try {
			$method->invokeArgs(
				null,
				array(
					&$output,
					&$output_map,
					'piece containing private article text',
					array( 1 => array( 'start' => 1, 'end' => 1 ) ),
				)
			);
			$this->fail( 'Expected the source map join to fail.' );
		} catch ( RuntimeException $exception ) {
			$this->assertSame( 'easymde_preview_source_map_join_failed', $exception->getMessage() );
			$this->assertStringNotContainsString( 'private article text', $exception->getMessage() );
			$this->assertStringNotContainsString( 'output=', $exception->getMessage() );
			$this->assertStringNotContainsString( 'keys=', $exception->getMessage() );
		}
	}

	public function test_preview_returns_a_privacy_safe_line_edit_map_for_top_level_blocks()
    {
        $markdown = "# Title\r\n\r\n" .
            "> quoted\r\n> continuation\r\n\r\n" .
            "- first\r\n- second\r\n\r\n" .
            "| Name | Value |\r\n| --- | --- |\r\n| One | Two |\r\n\r\n" .
            "```php\r\necho 'ok';\r\n```\r\n\r\n" .
            "![Caption](https://example.test/image.png)\r\n";

        $preview = MarkdownRenderer::render_preview( $markdown, 'default' );

        $this->assertArrayHasKey( 'html', $preview );
        $this->assertArrayHasKey( 'editMap', $preview );
        $this->assertSame( 1, $preview['editMap']['version'] );
        $this->assertSame( 'line', $preview['editMap']['coordinate'] );
        $this->assertNotEmpty( $preview['editMap']['blocks'] );

        $ids = array();
        foreach ( $preview['editMap']['blocks'] as $block ) {
            $this->assertSame( array( 'id', 'startLine', 'endLine', 'editable' ), array_keys( $block ) );
            $this->assertSame( 'b' . count( $ids ), $block['id'] );
            $this->assertIsInt( $block['startLine'] );
            $this->assertIsInt( $block['endLine'] );
            $this->assertGreaterThanOrEqual( $block['startLine'], $block['endLine'] );
            $this->assertIsBool( $block['editable'] );
            $this->assertArrayNotHasKey( 'body', $block );
            $this->assertArrayNotHasKey( 'hash', $block );
            $this->assertArrayNotHasKey( 'url', $block );
            $ids[] = $block['id'];
        }

		$document              = new DOMDocument( '1.0', 'UTF-8' );
		$previous_libxml_state = libxml_use_internal_errors( true );
		try {
			$loaded = $document->loadHTML(
				'<?xml encoding="UTF-8"><div id="preview-root">' . $preview['html'] . '</div>',
				LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
			);
		} finally {
			libxml_clear_errors();
			libxml_use_internal_errors( $previous_libxml_state );
		}
		$this->assertTrue( $loaded );
        $root = $document->getElementById( 'preview-root' );
        $this->assertNotNull( $root );
        $root_blocks = array();
        foreach ( $root->childNodes as $child ) {
            if ( $child instanceof DOMElement ) {
                $root_blocks[] = $child;
            }
        }

        $this->assertCount( count( $preview['editMap']['blocks'] ), $root_blocks );
        foreach ( $root_blocks as $root_block ) {
            $this->assertSame( 1, $root_block->attributes->length > 0 ? 1 : 0 );
            $id = $root_block->getAttribute( 'data-easymde-visual-block-id' );
            $this->assertContains( $id, $ids );
            $this->assertFalse( $root_block->hasAttribute( 'data-easymde-visual-source-id' ) );
        }
        $this->assertStringNotContainsString( 'data-easymde-visual-source-id', $preview['html'] );
    }

    public function test_preview_marks_generated_top_level_nodes_non_editable()
    {
        $preview = MarkdownRenderer::render_preview( "[TOC]\n\n## Heading\n\nBody", 'default' );
        $blocks  = $preview['editMap']['blocks'];

        $this->assertCount( 3, $blocks );
        $this->assertFalse( $blocks[0]['editable'] );
        $this->assertSame( 0, $blocks[0]['startLine'] );
        $this->assertSame( 0, $blocks[0]['endLine'] );
        $this->assertTrue( $blocks[1]['editable'] );
        $this->assertTrue( $blocks[2]['editable'] );
    }

    public function test_red_crimson_generated_footnotes_follow_source_boundaries()
    {
        $markdown = "[TOC]\n\n" .
            "## Heading\n\n" .
            "[Reference](https://example.test/reference \"Reference title\")";
        $preview = MarkdownRenderer::render_preview( $markdown, 'red-crimson' );
        $blocks  = $preview['editMap']['blocks'];

        $this->assertStringContainsString( 'class="easymde-toc"', $preview['html'] );
        $this->assertStringContainsString( 'class="footnotes-sep"', $preview['html'] );
        $this->assertStringContainsString( 'class="footnotes"', $preview['html'] );
        $this->assertNotEmpty( $blocks );
        $this->assertFalse( $blocks[0]['editable'] );
        $this->assertSame( 0, $blocks[0]['startLine'] );
        $this->assertSame( 0, $blocks[0]['endLine'] );

        $previous_end = 0;
        $editable     = array();
        foreach ( $blocks as $block ) {
            $this->assertGreaterThanOrEqual( $previous_end, $block['startLine'] );
            $this->assertGreaterThanOrEqual( $block['startLine'], $block['endLine'] );
            if ( $block['editable'] ) {
                $editable[] = $block;
            }
            $previous_end = $block['endLine'];
        }

        $last_editable = end( $editable );
        $last_block    = end( $blocks );
        $this->assertIsArray( $last_editable );
        $this->assertIsArray( $last_block );
        $this->assertFalse( $last_block['editable'] );
        $this->assertSame( $last_editable['endLine'], $last_block['startLine'] );
        $this->assertSame( $last_editable['endLine'], $last_block['endLine'] );
    }

    public function test_preview_keeps_theme_wrapped_source_blocks_editable()
    {
        $preview = MarkdownRenderer::render_preview(
            "::: block-1\n\n## Heading\n\nBody\n\n:::",
            'cupid-busy'
        );

        $this->assertStringContainsString( 'class="block-1"', $preview['html'] );
        $this->assertCount( 1, $preview['editMap']['blocks'] );
        $this->assertSame( 2, $preview['editMap']['blocks'][0]['startLine'] );
        $this->assertSame( 5, $preview['editMap']['blocks'][0]['endLine'] );
        $this->assertTrue( $preview['editMap']['blocks'][0]['editable'] );
    }

    public function test_preview_image_figures_and_theme_footnotes_keep_source_ranges_without_leaking_markers()
    {
        $preview = MarkdownRenderer::render_preview(
            "![Caption](https://example.test/image.png)\n\n[Reference](https://example.test/reference)",
            'rose-purple'
        );

		$this->assertStringContainsString( '<figure', $preview['html'] );
        $this->assertStringContainsString( 'class="footnotes"', $preview['html'] );
        $this->assertNotEmpty( $preview['editMap']['blocks'] );
        foreach ( $preview['editMap']['blocks'] as $block ) {
            $this->assertArrayNotHasKey( 'body', $block );
            $this->assertArrayNotHasKey( 'hash', $block );
            $this->assertArrayNotHasKey( 'url', $block );
        }
        $this->assertStringNotContainsString( 'data-easymde-visual-source-id', $preview['html'] );
    }

    public function test_preview_maps_math_after_crlf_blank_lines_without_changing_formal_rendering()
    {
        $markdown = "```php\r\n\$x\$\r\n```\r\n\r\nBefore\r\n\r\n\$\$x + y\$\$\r\n\r\nAfter\r\n";
        $preview  = MarkdownRenderer::render_preview( $markdown, 'default' );

        $this->assertSame( 4, count( $preview['editMap']['blocks'] ) );
        $this->assertSame( array( 'startLine' => 0, 'endLine' => 3 ), array_intersect_key( $preview['editMap']['blocks'][0], array_flip( array( 'startLine', 'endLine' ) ) ) );
        $this->assertSame( array( 'startLine' => 4, 'endLine' => 5 ), array_intersect_key( $preview['editMap']['blocks'][1], array_flip( array( 'startLine', 'endLine' ) ) ) );
        $this->assertSame( array( 'startLine' => 6, 'endLine' => 7 ), array_intersect_key( $preview['editMap']['blocks'][2], array_flip( array( 'startLine', 'endLine' ) ) ) );
        $this->assertSame( array( 'startLine' => 8, 'endLine' => 9 ), array_intersect_key( $preview['editMap']['blocks'][3], array_flip( array( 'startLine', 'endLine' ) ) ) );
        $this->assertStringContainsString( '<pre data-easymde-visual-block-id="b0">', $preview['html'] );
        $this->assertStringContainsString( '<div class="easymde-math easymde-math-block" data-easymde-visual-block-id="b2">', $preview['html'] );
        $this->assertStringContainsString( '<p data-easymde-visual-block-id="b3">After</p>', $preview['html'] );
        $this->assertStringNotContainsString( 'data-easymde-visual-source-id', $preview['html'] );
    }

	public function test_preview_marks_split_block_math_roots_read_only_without_overlapping_source_ranges() {
		$preview = MarkdownRenderer::render_preview( 'Display math: \\[\\frac{1}{n}\\].', 'default' );
		$blocks  = $preview['editMap']['blocks'];

		$this->assertCount( 3, $blocks );
		$this->assertSame(
			array(
				array( 'id' => 'b0', 'startLine' => 1, 'endLine' => 1, 'editable' => false ),
				array( 'id' => 'b1', 'startLine' => 1, 'endLine' => 1, 'editable' => false ),
				array( 'id' => 'b2', 'startLine' => 1, 'endLine' => 1, 'editable' => false ),
			),
			$blocks
		);
		$this->assertStringContainsString( '<p data-easymde-visual-block-id="b0">Display math:</p>', $preview['html'] );
		$this->assertStringContainsString( '<div class="easymde-math easymde-math-block" data-easymde-visual-block-id="b1">', $preview['html'] );
		$this->assertStringContainsString( '<p data-easymde-visual-block-id="b2">.</p>', $preview['html'] );
	}

	public function test_preview_resets_read_only_duplicate_group_before_following_source_block() {
		$preview = MarkdownRenderer::render_preview(
			"First: \\[x\\].\n\nSecond: \\[y\\].\n\nAfter",
			'default'
		);
		$ranges = array_map(
			static function ( $block ) {
				return array(
					'startLine' => $block['startLine'],
					'endLine'   => $block['endLine'],
					'editable'  => $block['editable'],
				);
			},
			$preview['editMap']['blocks']
		);

		$this->assertSame(
			array(
				array( 'startLine' => 1, 'endLine' => 1, 'editable' => false ),
				array( 'startLine' => 1, 'endLine' => 1, 'editable' => false ),
				array( 'startLine' => 1, 'endLine' => 1, 'editable' => false ),
				array( 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'startLine' => 4, 'endLine' => 5, 'editable' => true ),
			),
			$ranges
		);
	}

	public function test_preview_marks_split_math_roots_read_only_when_prose_continues_on_the_next_line() {
		$preview = MarkdownRenderer::render_preview( "Before: \\[x\\] after.\nMore", 'default' );

		$this->assertSame(
			array(
				array( 'id' => 'b0', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b1', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b2', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
			),
			$preview['editMap']['blocks']
		);
		$this->assertStringContainsString( 'Before:', $preview['html'] );
		$this->assertStringContainsString( 'More', $preview['html'] );
	}

	public function test_preview_marks_split_math_roots_read_only_when_prose_precedes_on_the_previous_line() {
		$preview = MarkdownRenderer::render_preview( "Intro\nBefore: \\[x\\] after.", 'default' );

		$this->assertSame(
			array(
				array( 'id' => 'b0', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b1', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b2', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
			),
			$preview['editMap']['blocks']
		);
		$this->assertStringContainsString( 'Intro', $preview['html'] );
		$this->assertStringContainsString( 'Before:', $preview['html'] );
	}

	public function test_preview_keeps_a_following_editable_paragraph_after_a_multiline_split_group() {
		$preview = MarkdownRenderer::render_preview( "Before: \\[x\\] after.\nMore\n\nEditable", 'default' );

		$this->assertSame(
			array(
				array( 'id' => 'b0', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b1', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b2', 'startLine' => 2, 'endLine' => 2, 'editable' => false ),
				array( 'id' => 'b3', 'startLine' => 3, 'endLine' => 4, 'editable' => true ),
			),
			$preview['editMap']['blocks']
		);
		$this->assertStringContainsString( 'More', $preview['html'] );
		$this->assertStringContainsString( '<p data-easymde-visual-block-id="b3">Editable</p>', $preview['html'] );
	}

	public function test_preview_unions_connected_split_roots_across_a_multiline_bridge_before_the_following_editable_paragraph() {
		$preview = MarkdownRenderer::render_preview(
			"Before: \\[x\\] tail.\nMiddle\nPrefix \\[y\\] after.\n\nEditable",
			'default'
		);

		$this->assertSame(
			array(
				array( 'id' => 'b0', 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'id' => 'b1', 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'id' => 'b2', 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'id' => 'b3', 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'id' => 'b4', 'startLine' => 3, 'endLine' => 3, 'editable' => false ),
				array( 'id' => 'b5', 'startLine' => 4, 'endLine' => 5, 'editable' => true ),
			),
			$preview['editMap']['blocks']
		);
		$this->assertStringContainsString( 'Middle', $preview['html'] );
		$this->assertStringContainsString( 'Prefix', $preview['html'] );
		$this->assertStringContainsString( '<p data-easymde-visual-block-id="b5">Editable</p>', $preview['html'] );
	}

	public function test_preview_rejects_invalid_source_block_types_order_and_bounds() {
		$cases = array(
			array( 'source_id' => 's0', 'startLine' => '0', 'endLine' => 1, 'editable' => true ),
			array( 'source_id' => 's0', 'startLine' => -1, 'endLine' => 1, 'editable' => true ),
			array( 'source_id' => 's0', 'startLine' => 1, 'endLine' => 0, 'editable' => true ),
			array( 'source_id' => 's1', 'startLine' => 0, 'endLine' => 1, 'editable' => true ),
			array( 'source_id' => 's0', 'startLine' => 0, 'endLine' => 1, 'editable' => 'true' ),
		);

		foreach ( $cases as $source_block ) {
			try {
				VisualPreviewBlockAnnotator::finalize(
					'<p data-easymde-visual-source-id="' . $source_block['source_id'] . '">A</p>',
					array( $source_block )
				);
				$this->fail( 'Expected malformed Preview source provenance to be rejected.' );
			} catch ( RuntimeException $exception ) {
				$this->assertSame( 'Preview source map contains an invalid source block.', $exception->getMessage() );
			}
		}
	}

	public function test_preview_rejects_an_overlap_that_crosses_the_previous_source_group_floor() {
		$source_blocks = array(
			array( 'source_id' => 's0', 'startLine' => 0, 'endLine' => 2, 'editable' => true ),
			array( 'source_id' => 's1', 'startLine' => 2, 'endLine' => 4, 'editable' => true ),
			array( 'source_id' => 's2', 'startLine' => 1, 'endLine' => 3, 'editable' => true ),
		);

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'Preview source ranges overlap without a deterministic source owner.' );
		VisualPreviewBlockAnnotator::finalize(
			'<p data-easymde-visual-source-id="s0">A</p>' .
			'<p data-easymde-visual-source-id="s1">B</p>' .
			'<p data-easymde-visual-source-id="s2">C</p>',
			$source_blocks
		);
	}

	public function test_preview_allows_a_new_overlap_group_starting_at_the_previous_source_floor() {
		$source_blocks = array(
			array( 'source_id' => 's0', 'startLine' => 0, 'endLine' => 2, 'editable' => true ),
			array( 'source_id' => 's1', 'startLine' => 2, 'endLine' => 4, 'editable' => true ),
			array( 'source_id' => 's2', 'startLine' => 2, 'endLine' => 3, 'editable' => true ),
		);
		$result = VisualPreviewBlockAnnotator::finalize(
			'<p data-easymde-visual-source-id="s0">A</p>' .
			'<p data-easymde-visual-source-id="s1">B</p>' .
			'<p data-easymde-visual-source-id="s2">C</p>',
			$source_blocks
		);

		$this->assertSame(
			array(
				array( 'id' => 'b0', 'startLine' => 0, 'endLine' => 2, 'editable' => true ),
				array( 'id' => 'b1', 'startLine' => 4, 'endLine' => 4, 'editable' => false ),
				array( 'id' => 'b2', 'startLine' => 4, 'endLine' => 4, 'editable' => false ),
			),
			$result['editMap']['blocks']
		);
	}

	public function test_preview_maps_mixed_line_endings_before_a_trailing_whitespace_only_line() {
		$markdown = "# Heading\r\n\rParagraph\n \t";
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );
		$blocks   = $preview['editMap']['blocks'];
		$lines    = preg_split( '/\r\n|\r|\n/', $markdown );

		$this->assertSame( array( 'b0', 'b1' ), array_column( $blocks, 'id' ) );
		$this->assertSame(
			array(
				array( 'startLine' => 0, 'endLine' => 1 ),
				array( 'startLine' => 2, 'endLine' => 3 ),
			),
			array_map(
				static function ( $block ) {
					return array(
						'startLine' => $block['startLine'],
						'endLine'   => $block['endLine'],
					);
				},
				$blocks
			)
		);
		$this->assertCount( 4, $lines );
		$this->assertSame( " \t", $lines[3] );
		$this->assertSame( true, $blocks[1]['editable'] );
	}

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

    public function test_preserves_math_delimiters_inside_fenced_code_blocks()
    {
        $markdown = <<<'MD'
```bash
printf '$x$'
printf '$$x$$'
printf '\(x\)'
printf '\[x\]'
```
MD;
        $html = MarkdownRenderer::render($markdown);

        $this->assertSame(0, substr_count($html, 'class="easymde-math'));
        $this->assertStringContainsString('printf \'$x$\'', $html);
        $this->assertStringContainsString('printf \'$$x$$\'', $html);
        $this->assertStringContainsString('printf \'\(x\)\'', $html);
        $this->assertStringContainsString('printf \'\[x\]\'', $html);
    }

    public function test_preserves_math_delimiters_inside_tilde_fenced_code_blocks()
    {
        $markdown = <<<'MD'
Real $y$.

~~~bash
printf '$x$'
printf '$$x$$'
printf '\(x\)'
printf '\[x\]'
~~~
MD;
        $html = MarkdownRenderer::render($markdown);

        $this->assertSame(1, substr_count($html, 'class="easymde-math'));
        $this->assertStringContainsString('<span class="easymde-math easymde-math-inline">\(y\)</span>', $html);
        $this->assertStringContainsString('printf \'$x$\'', $html);
        $this->assertStringContainsString('printf \'$$x$$\'', $html);
        $this->assertStringContainsString('printf \'\(x\)\'', $html);
        $this->assertStringContainsString('printf \'\[x\]\'', $html);
    }

    public function test_preserves_math_delimiters_inside_inline_code_but_renders_real_math()
    {
        $html = MarkdownRenderer::render(
            'Inline ` $x$ ` and `$$x$$` stay literal, while $y$ renders.'
        );

        $this->assertSame(1, substr_count($html, 'class="easymde-math'));
        $this->assertStringContainsString('<code>$x$</code>', $html);
        $this->assertStringContainsString('<code>$$x$$</code>', $html);
        $this->assertStringContainsString('<span class="easymde-math easymde-math-inline">\\(y\\)</span>', $html);
    }

    public function test_preserves_math_delimiters_inside_indented_code_but_renders_following_math()
    {
        $markdown = <<<'MD'
    printf '$x$'

Following $y$.
MD;
        $html = MarkdownRenderer::render($markdown);

        $this->assertSame(1, substr_count($html, 'class="easymde-math'));
        $this->assertStringContainsString('printf \'$x$\'', $html);
        $this->assertStringContainsString('<span class="easymde-math easymde-math-inline">\\(y\\)</span>', $html);
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
