<?php

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\VisualPreviewBlockAnnotator;
use League\CommonMark\Extension\CommonMark\Node\Block\FencedCode;
use League\CommonMark\Node\Block\Document;
use League\CommonMark\Parser\MarkdownParser;

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

	public function test_preview_preserves_toolbar_placeholder_link_structure_and_source_map()
	{
		$cases = array(
			'placeholder' => array(
				'markdown' => '[First heading](https://)',
				'href'     => 'https://',
			),
			'normal'      => array(
				'markdown' => '[First heading](https://example.test)',
				'href'     => 'https://example.test',
			),
		);

		foreach ( $cases as $case_id => $case ) {
			$preview              = MarkdownRenderer::render_preview( $case['markdown'], 'default' );
			$document             = new DOMDocument( '1.0', 'UTF-8' );
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

			$this->assertTrue( $loaded, $case_id );
			$anchors = $document->getElementsByTagName( 'a' );
			$this->assertCount( 1, $anchors, $case_id );
			$anchor = $anchors->item( 0 );
			$this->assertInstanceOf( DOMElement::class, $anchor, $case_id );
			$this->assertSame( 'First heading', $anchor->textContent, $case_id );
			$this->assertSame( $case['href'], $anchor->getAttribute( 'href' ), $case_id );

			$this->assertSame( 1, $preview['editMap']['version'], $case_id );
			$this->assertSame( 'line', $preview['editMap']['coordinate'], $case_id );
			$this->assertCount( 1, $preview['editMap']['blocks'], $case_id );
			$this->assertSame(
				array(
					'id'        => 'b0',
					'startLine' => 0,
					'endLine'   => 1,
					'editable'  => true,
				),
				$preview['editMap']['blocks'][0],
				$case_id
			);
		}
	}

	public function test_preview_returns_code_body_map_from_the_same_ast_with_original_line_endings()
	{
		$markdown = "```php\r\none\r\ntwo\r\n```\r\n\r\n    indented\r\n    body\r\n";
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );

		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'status'     => 'available',
				'entries'    => array(
					array(
						'kind'      => 'fenced',
						'startLine' => 0,
						'endLine'   => 4,
						'status'    => 'available',
						'content'   => "one\r\ntwo\r\n",
					),
					array(
						'kind'      => 'indented',
						'startLine' => 5,
						'endLine'   => 7,
						'status'    => 'available',
						'content'   => "indented\r\nbody\r\n",
					),
				),
			),
			$preview['codeMap']
		);
	}

	public function test_preview_code_body_map_preserves_empty_eof_and_mixed_line_endings()
	{
		$cases = array(
			'empty' => array(
				'markdown' => "```php\r\n```\r\n",
				'entry'   => array(
					'kind'      => 'fenced',
					'startLine' => 0,
					'endLine'   => 2,
					'status'    => 'available',
					'content'   => '',
				),
			),
			'eof' => array(
				'markdown' => "```php\r\none",
				'entry'   => array(
					'kind'      => 'fenced',
					'startLine' => 0,
					'endLine'   => 2,
					'status'    => 'available',
					'content'   => 'one',
				),
			),
			'mixed' => array(
				'markdown' => "```php\rone\rtwo\r\nthree",
				'entry'   => array(
					'kind'      => 'fenced',
					'startLine' => 0,
					'endLine'   => 4,
					'status'    => 'available',
					'content'   => "one\rtwo\r\nthree",
				),
			),
		);

		foreach ( $cases as $case_id => $case ) {
			$preview = MarkdownRenderer::render_preview( $case['markdown'], 'default' );
			$this->assertSame( array( $case['entry'] ), $preview['codeMap']['entries'], $case_id );
		}
	}

	public function test_preview_code_body_map_preserves_partial_tab_indentation_from_the_real_parser()
	{
		$preview = MarkdownRenderer::render_preview( "- ```\n\tone\n  ```", 'default' );

		$this->assertSame(
			array(
				array(
					'kind'      => 'fenced',
					'startLine' => 0,
					'endLine'   => 3,
					'status'    => 'available',
					'content'   => "  one\n",
				),
			),
			$preview['codeMap']['entries']
		);
	}

	public function test_preview_returns_code_projection_with_partial_tab_row_offsets()
	{
		$preview = MarkdownRenderer::render_preview( "- ```ts\n\tone\n  ```", 'default' );

		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'offsetUnit' => 'utf16',
				'status'     => 'available',
				'entries'    => array(
					array(
						'kind'        => 'fenced',
						'startLine'   => 0,
						'endLine'     => 3,
						'status'      => 'available',
						'info'        => 'ts',
						'fenceOffset' => 0,
						'rows'        => array(
							array(
								'sourceLine'         => 1,
								'contentLine'        => 0,
								'prefixEnd'          => 0,
								'prefixTabColumns'   => 2,
								'literalFrom'        => 1,
								'literalLeadingSpaces' => 2,
							),
						),
					),
				),
			),
			$preview['codeProjection']
		);
	}

	public function test_preview_code_projection_counts_a_shared_tab_after_a_blockquote_prefix()
	{
		$preview = MarkdownRenderer::render_preview( "> ```js\n>\tone\n> ```\n", 'default' );

		$this->assertSame(
			array(
				array(
					'kind'        => 'fenced',
					'startLine'   => 0,
					'endLine'     => 3,
					'status'      => 'available',
					'info'        => 'js',
					'fenceOffset' => 0,
					'rows'        => array(
						array(
							'sourceLine'           => 1,
							'contentLine'          => 0,
							'prefixEnd'            => 1,
							'prefixTabColumns'     => 1,
							'literalFrom'          => 2,
							'literalLeadingSpaces' => 2,
						),
					),
				),
			),
			$preview['codeProjection']['entries']
		);
	}

	public function test_preview_code_projection_rejects_a_non_whitespace_delegate_consumption()
	{
		$normalized = "```\nbody\n```";
		$method     = new ReflectionMethod( MarkdownRenderer::class, 'create_converter' );
		$method->setAccessible( true );
		$converter = $method->invoke( null, true );
		$document  = ( new MarkdownParser( $converter->getEnvironment() ) )->parse( $normalized );
		$node      = $document->firstChild();
		$this->assertInstanceOf( FencedCode::class, $node );
		$metadata = $node->data->get( 'easymde_code_projection' );
		$metadata['rows'][0]['after'] = array(
			'position'               => 1,
			'column'                 => 1,
			'remainderLength'        => 3,
			'remainderLeadingSpaces' => 0,
		);
		$node->data->set( 'easymde_code_projection', $metadata );
		$projection = VisualPreviewBlockAnnotator::describe_source_code_projections(
			$document,
			$normalized,
			array(
				1 => array( 'start' => 1, 'end' => 1 ),
				2 => array( 'start' => 2, 'end' => 2 ),
				3 => array( 'start' => 3, 'end' => 3 ),
			),
			$normalized
		);

		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'offsetUnit' => 'utf16',
				'status'     => 'available',
				'entries'    => array(
					array(
						'kind'      => 'fenced',
						'startLine' => 0,
						'endLine'   => 3,
						'status'    => 'unavailable',
						'code'      => 'preview-code-projection-source-unavailable',
					),
				),
			),
			$projection
		);
	}

	public function test_preview_returns_indented_code_projection_without_inventing_blank_tail_rows()
	{
		$preview = MarkdownRenderer::render_preview( "    one\n        \n    two\n    \n", 'default' );

		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'offsetUnit' => 'utf16',
				'status'     => 'available',
				'entries'    => array(
					array(
						'kind'      => 'indented',
						'startLine' => 0,
						'endLine'   => 3,
						'status'    => 'available',
						'rows'      => array(
							array(
								'sourceLine'          => 0,
								'contentLine'         => 0,
								'prefixEnd'           => 0,
								'prefixTabColumns'    => 0,
								'literalFrom'         => 4,
								'literalLeadingSpaces' => 0,
							),
							array(
								'sourceLine'          => 2,
								'contentLine'         => 2,
								'prefixEnd'           => 0,
								'prefixTabColumns'    => 0,
								'literalFrom'         => 4,
								'literalLeadingSpaces' => 0,
							),
						),
					),
				),
			),
			$preview['codeProjection']
		);
	}

	public function test_preview_code_projection_preserves_empty_eof_and_mixed_source_rows()
	{
		$cases = array(
			'empty' => array(
				'markdown' => "```php\r\n```\r\n",
				'rows'     => array(),
			),
			'eof' => array(
				'markdown' => "```php\r\none",
				'rows'     => array(
					array(
						'sourceLine'          => 1,
						'contentLine'         => 0,
						'prefixEnd'           => 0,
						'prefixTabColumns'    => 0,
						'literalFrom'         => 0,
						'literalLeadingSpaces' => 0,
					),
				),
			),
			'mixed' => array(
				'markdown' => "```php\rone\rtwo\r\nthree",
				'rows'     => array(
					array(
						'sourceLine'          => 1,
						'contentLine'         => 0,
						'prefixEnd'           => 0,
						'prefixTabColumns'    => 0,
						'literalFrom'         => 0,
						'literalLeadingSpaces' => 0,
					),
					array(
						'sourceLine'          => 2,
						'contentLine'         => 1,
						'prefixEnd'           => 0,
						'prefixTabColumns'    => 0,
						'literalFrom'         => 0,
						'literalLeadingSpaces' => 0,
					),
					array(
						'sourceLine'          => 3,
						'contentLine'         => 2,
						'prefixEnd'           => 0,
						'prefixTabColumns'    => 0,
						'literalFrom'         => 0,
						'literalLeadingSpaces' => 0,
					),
				),
			),
		);

		foreach ( $cases as $case_id => $case ) {
			$preview = MarkdownRenderer::render_preview( $case['markdown'], 'default' );
			$this->assertSame( $case['rows'], $preview['codeProjection']['entries'][0]['rows'], $case_id );
		}
	}

	public function test_preview_code_projection_rejects_theme_mutation_inside_a_code_body()
	{
		$preview = MarkdownRenderer::render_preview( "```\n![alt](https://example.test/image.png =50%x)\n```", 'cupid-busy' );

		$this->assertStringContainsString( '<pre', $preview['html'] );
		$this->assertSame( 'available', $preview['codeMap']['status'] );
		$this->assertSame( 'unavailable', $preview['codeProjection']['entries'][0]['status'] );
		$this->assertSame( 'preview-code-projection-source-unavailable', $preview['codeProjection']['entries'][0]['code'] );
	}

	public function test_preview_code_projection_marks_an_oversized_fence_info_unavailable()
	{
		$preview = MarkdownRenderer::render_preview( "```" . str_repeat( 'x', 1025 ) . "\none\n```", 'default' );

		$this->assertSame(
			array(
				'kind'      => 'fenced',
				'startLine' => 0,
				'endLine'   => 3,
				'status'    => 'unavailable',
				'code'      => 'preview-code-projection-info-limit',
			),
			$preview['codeProjection']['entries'][0]
		);
	}

	public function test_preview_code_projection_serializer_keeps_unicode_line_terminators_unescaped()
	{
		$method  = new ReflectionMethod( VisualPreviewBlockAnnotator::class, 'encode_code_projection' );
		$method->setAccessible( true );
		$encoded = $method->invoke( null, array( 'info' => "before\u{2028}after\u{2029}" ) );

		$this->assertIsString( $encoded );
		$this->assertStringContainsString( "before\u{2028}after\u{2029}", $encoded );
		$this->assertStringNotContainsString( '\\u2028', $encoded );
		$this->assertStringNotContainsString( '\\u2029', $encoded );
	}

	public function test_preview_code_body_map_reports_the_global_entry_limit_without_dropping_html()
	{
		$markdown = str_repeat( "```\n```\n", 50001 );
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );

		$this->assertStringContainsString( '<pre', $preview['html'] );
		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'status'     => 'unavailable',
				'code'       => 'preview-code-body-limit',
			),
			$preview['codeMap']
		);
		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'offsetUnit' => 'utf16',
				'status'     => 'unavailable',
				'code'       => 'preview-code-projection-limit',
			),
			$preview['codeProjection']
		);
	}

	public function test_preview_code_projection_stops_observing_before_the_json_budget_and_keeps_html()
	{
		$markdown = "```\n" . str_repeat( "x\n", 40000 ) . "```";
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );

		$this->assertStringContainsString( '<pre', $preview['html'] );
		$this->assertSame( 'available', $preview['codeMap']['status'] );
		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'offsetUnit' => 'utf16',
				'status'     => 'unavailable',
				'code'       => 'preview-code-projection-limit',
			),
			$preview['codeProjection']
		);
	}

	public function test_preview_code_body_map_marks_a_changed_source_row_unavailable()
	{
		$normalized = "```php\none\n```";
		$method     = new ReflectionMethod( MarkdownRenderer::class, 'create_converter' );
		$method->setAccessible( true );
		$converter = $method->invoke( null );
		$document  = ( new MarkdownParser( $converter->getEnvironment() ) )->parse( $normalized );
		$line_map  = array(
			1 => array( 'start' => 1, 'end' => 1 ),
			2 => array( 'start' => 1, 'end' => 1 ),
			3 => array( 'start' => 3, 'end' => 3 ),
		);

		$code_map = VisualPreviewBlockAnnotator::describe_source_code_bodies(
			$document,
			$normalized,
			$line_map,
			"```php\nchanged\n```"
		);

		$this->assertSame(
			array(
				array(
					'kind'      => 'fenced',
					'startLine' => 0,
					'endLine'   => 3,
					'status'    => 'unavailable',
					'code'      => 'preview-code-body-source-unavailable',
				),
			),
			$code_map['entries']
		);
	}

	public function test_preview_code_body_map_reports_the_global_byte_limit()
	{
		$body     = str_repeat( 'x', 4194305 );
		$document = new Document();
		$node     = new FencedCode( 3, '`', 0 );
		$node->setStartLine( 1 );
		$node->setEndLine( 2 );
		$node->setLiteral( $body . "\n" );
		$document->appendChild( $node );
		$source = "```\n" . $body . "\n";

		$code_map = VisualPreviewBlockAnnotator::describe_source_code_bodies(
			$document,
			$source,
			array(
				1 => array( 'start' => 1, 'end' => 1 ),
				2 => array( 'start' => 2, 'end' => 2 ),
			),
			$source
		);

		$this->assertSame(
			array(
				'version'    => 1,
				'coordinate' => 'line',
				'status'     => 'unavailable',
				'code'       => 'preview-code-body-limit',
			),
			$code_map
		);
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

	public function test_preview_repairs_a_paragraph_that_commonmark_merges_into_an_adjacent_table() {
		$markdown = "Before.\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );
		$blocks   = $preview['editMap']['blocks'];

		$this->assertSame( array( 'b0', 'b1' ), array_column( $blocks, 'id' ) );
		$this->assertSame( array( 'startLine' => 0, 'endLine' => 1 ), self::block_range( $blocks[0] ) );
		$this->assertSame( array( 'startLine' => 1, 'endLine' => 4 ), self::block_range( $blocks[1] ) );
		$this->assertGreaterThanOrEqual( $blocks[0]['endLine'], $blocks[1]['startLine'] );
		$this->assertTrue( $blocks[0]['editable'] );
		$this->assertTrue( $blocks[1]['editable'] );
		$this->assertStringContainsString( '<p data-easymde-visual-block-id="b0">Before.</p>', $preview['html'] );
		$this->assertStringContainsString( '<section class="table-container easymde-table-container" data-easymde-visual-block-id="b1">', $preview['html'] );
		$this->assertStringNotContainsString( 'data-easymde-visual-source-id', $preview['html'] );
		$this->assertStringContainsString( '<p>Before.</p>', MarkdownRenderer::render( $markdown, 'default' ) );
	}

	public function test_preview_repairs_a_multi_line_paragraph_that_commonmark_merges_into_an_adjacent_table() {
		$markdown = "Line 1\nLine 2\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );
		$blocks   = $preview['editMap']['blocks'];

		$this->assertCount( 2, $blocks );
		$this->assertSame( array( 'startLine' => 0, 'endLine' => 2 ), self::block_range( $blocks[0] ) );
		$this->assertSame( array( 'startLine' => 2, 'endLine' => 5 ), self::block_range( $blocks[1] ) );
		$this->assertGreaterThanOrEqual( $blocks[0]['endLine'], $blocks[1]['startLine'] );
		$this->assertStringContainsString( "<p data-easymde-visual-block-id=\"b0\">Line 1\nLine 2</p>", $preview['html'] );
	}

	public function test_preview_repairs_paragraph_adjacent_table_source_ranges_without_overlap_or_gaps() {
		$cases = array(
			'three body rows'          => array(
				'markdown' => "Line 1\nLine 2\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n",
				'ranges'   => array( array( 0, 2 ), array( 2, 7 ) ),
			),
			'table without body'       => array(
				'markdown' => "Before.\n| a | b |\n| --- | --- |\n",
				'ranges'   => array( array( 0, 1 ), array( 1, 3 ) ),
			),
			'table then paragraph'     => array(
				'markdown' => "Before.\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n",
				'ranges'   => array( array( 0, 1 ), array( 1, 4 ), array( 5, 6 ) ),
			),
			'crlf line endings'        => array(
				'markdown' => "Before.\r\n| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n",
				'ranges'   => array( array( 0, 1 ), array( 1, 4 ) ),
			),
			'paragraph delimiter look' => array(
				'markdown' => "Line A\nLine B\n--- | ---\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
				'ranges'   => array( array( 0, 3 ), array( 3, 6 ) ),
			),
		);

		foreach ( $cases as $case_id => $case ) {
			$preview      = MarkdownRenderer::render_preview( $case['markdown'], 'default' );
			$blocks       = $preview['editMap']['blocks'];
			$ranges       = array();
			$lines        = preg_split( '/\r\n|\r|\n/', $case['markdown'] );
			$source_lines = count( $lines ) - ( '' === $lines[ count( $lines ) - 1 ] ? 1 : 0 );

			foreach ( $blocks as $index => $block ) {
				$ranges[] = array( $block['startLine'], $block['endLine'] );
				$this->assertGreaterThanOrEqual( $block['startLine'], $block['endLine'], $case_id );
				$this->assertLessThanOrEqual( count( $lines ), $block['endLine'], $case_id );
				if ( 0 < $index ) {
					$this->assertGreaterThanOrEqual( $blocks[ $index - 1 ]['endLine'], $block['startLine'], $case_id );
				}
			}

			$this->assertSame( $case['ranges'], $ranges, $case_id );
			$this->assertSame( $source_lines, end( $ranges )[1], $case_id );
		}
	}

	public function test_preview_keeps_a_table_alignment_marker_above_an_adjacent_table_editable() {
		$markdown = "<!-- easymde-table-align:v1 [[1,\"center\"]] -->\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
		$preview  = MarkdownRenderer::render_preview( $markdown, 'default' );

		$this->assertCount( 1, $preview['editMap']['blocks'] );
		$this->assertSame( array( 'startLine' => 0, 'endLine' => 4 ), self::block_range( $preview['editMap']['blocks'][0] ) );
		$this->assertTrue( $preview['editMap']['blocks'][0]['editable'] );
		$this->assertStringContainsString( 'text-align:center', $preview['html'] );
	}

	public function test_preview_rejects_an_invalid_block_source_range() {
		$method     = new ReflectionMethod( MarkdownRenderer::class, 'create_converter' );
		$method->setAccessible( true );
		$converter  = $method->invoke( null, true );
		$document   = ( new MarkdownParser( $converter->getEnvironment() ) )->parse( "Body\n" );
		$paragraph  = $document->firstChild();
		$this->assertNotNull( $paragraph );
		$paragraph->setEndLine( 0 );

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'CommonMark did not provide a valid source range for a Preview block.' );
		VisualPreviewBlockAnnotator::describe_source_blocks( $document, array(), "Body\n" );
	}

	public function test_preview_rejects_a_repaired_delimiter_line_that_is_not_a_table_delimiter() {
		$method    = new ReflectionMethod( MarkdownRenderer::class, 'create_converter' );
		$method->setAccessible( true );
		$converter = $method->invoke( null, true );
		$markdown  = "Before.\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
		$document  = ( new MarkdownParser( $converter->getEnvironment() ) )->parse( $markdown );

		$this->assertSame(
			array(
				array( 'source_id' => 's0', 'startLine' => 0, 'endLine' => 1, 'editable' => true ),
				array( 'source_id' => 's1', 'startLine' => 1, 'endLine' => 4, 'editable' => true ),
			),
			VisualPreviewBlockAnnotator::describe_source_blocks( $document, array(), $markdown )
		);

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'CommonMark did not provide a valid source range for a Preview block.' );
		VisualPreviewBlockAnnotator::describe_source_blocks( $document, array(), "Before.\n| a | b |\n| no | no |\n| 1 | 2 |\n" );
	}

	public function test_preview_repairs_indented_paragraph_split_table_delimiters() {
		$method    = new ReflectionMethod( MarkdownRenderer::class, 'create_converter' );
		$method->setAccessible( true );
		$converter = $method->invoke( null, true );
		$parser    = new MarkdownParser( $converter->getEnvironment() );

		$cases = array(
			'four spaces before pipe'       => "Intro\n| A | B |\n    | --- | --- |\n| 1 | 2 |\n",
			'tab before pipe'               => "Intro\n| A | B |\n\t| --- | --- |\n| 1 | 2 |\n",
			'mixed spaces and tabs'         => "Intro\n| A | B |\n  \t  | --- | --- |\n| 1 | 2 |\n",
			'four spaces without edge pipe' => "Intro\n| A | B |\n    --- | ---\n| 1 | 2 |\n",
			'tab without edge pipe'         => "Intro\n| A | B |\n\t--- | ---\n| 1 | 2 |\n",
		);

		foreach ( $cases as $case_id => $markdown ) {
			$document = $parser->parse( $markdown );

			$this->assertSame(
				array(
					array(
						'source_id' => 's0',
						'startLine' => 0,
						'endLine'   => 1,
						'editable'  => true,
					),
					array(
						'source_id' => 's1',
						'startLine' => 1,
						'endLine'   => 4,
						'editable'  => true,
					),
				),
				VisualPreviewBlockAnnotator::describe_source_blocks( $document, array(), $markdown ),
				$case_id
			);

			$preview = MarkdownRenderer::render_preview( $markdown, 'default' );
			$blocks  = $preview['editMap']['blocks'];
			$this->assertCount( 2, $blocks, $case_id );
			$this->assertSame( array( 'startLine' => 0, 'endLine' => 1 ), self::block_range( $blocks[0] ), $case_id );
			$this->assertSame( array( 'startLine' => 1, 'endLine' => 4 ), self::block_range( $blocks[1] ), $case_id );
			$this->assertTrue( $blocks[0]['editable'], $case_id );
			$this->assertTrue( $blocks[1]['editable'], $case_id );
		}
	}

	public function test_preview_rejects_an_indented_non_delimiter_line_for_split_table_repair() {
		$method    = new ReflectionMethod( MarkdownRenderer::class, 'create_converter' );
		$method->setAccessible( true );
		$converter = $method->invoke( null, true );
		$markdown  = "Intro\n| A | B |\n    | --- | --- |\n| 1 | 2 |\n";
		$document  = ( new MarkdownParser( $converter->getEnvironment() ) )->parse( $markdown );

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'CommonMark did not provide a valid source range for a Preview block.' );
		VisualPreviewBlockAnnotator::describe_source_blocks( $document, array(), "Intro\n| A | B |\n    | no | no |\n| 1 | 2 |\n" );
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

    public function test_renders_explicit_image_scale_markers_without_losing_image_fields()
    {
        foreach ( array( 25, 33, 50, 67, 100, 150, 200 ) as $width ) {
            $html = MarkdownRenderer::render(
                '![Alt text](https://example.test/image.png "Image title {width=' . $width . '%}")'
            );

            $document = new DOMDocument( '1.0', 'UTF-8' );
            $previous_libxml_state = libxml_use_internal_errors( true );
            try {
                $loaded = $document->loadHTML(
                    '<?xml encoding="UTF-8"><div id="preview-root">' . $html . '</div>',
                    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
                );
            } finally {
                libxml_clear_errors();
                libxml_use_internal_errors( $previous_libxml_state );
            }

            $this->assertTrue( $loaded );
            $image = $document->getElementsByTagName( 'img' )->item( 0 );
            $this->assertInstanceOf( DOMElement::class, $image );
            $this->assertSame( 'Alt text', $image->getAttribute( 'alt' ) );
            $this->assertSame( 'Image title', $image->getAttribute( 'title' ) );
            $this->assertSame( 'https://example.test/image.png', $image->getAttribute( 'src' ) );
            $this->assertSame( $width . '%', $image->getAttribute( 'width' ) );
            $this->assertSame( (string) $width, $image->getAttribute( 'data-easymde-image-scale' ) );
        }
    }

    public function test_standard_image_without_scale_remains_unscaled()
    {
        $html = MarkdownRenderer::render(
            '![Alt text](https://example.test/image.png "Image title")'
        );

        $this->assertStringContainsString( 'alt="Alt text"', $html );
        $this->assertStringContainsString( 'title="Image title"', $html );
        $this->assertStringNotContainsString( 'width="', $html );
        $this->assertStringNotContainsString( 'data-easymde-image-scale', $html );
    }

    public function test_angle_image_destination_does_not_gain_a_backslash_escape()
    {
        $html = MarkdownRenderer::render(
            '![Alt text](<https://example.test/a b.png>)'
        );

        $this->assertStringNotContainsString( '%5C%20', $html );
        $this->assertStringNotContainsString( '\\%20', $html );
        $this->assertStringContainsString( 'a%20b.png', $html );
    }

    public function test_angle_image_destination_preserves_a_right_parenthesis()
    {
        $html = MarkdownRenderer::render(
            '![Alt text](<https://example.test/a)b.png>)'
        );

        $this->assertStringContainsString( 'https://example.test/a)b.png', $html );
        $this->assertStringNotContainsString( 'src="https://example.test/a"', $html );
    }

    public function test_image_scale_markers_in_code_are_literal_and_invalid_markers_fail_fast()
    {
        $html = MarkdownRenderer::render(
            "```markdown\n![Alt](https://example.test/image.png \"{width=50%}\")\n```"
        );
        $this->assertStringContainsString( '{width=50%}', $html );
        $this->assertStringNotContainsString( 'width="50%"', $html );

        foreach (
            array(
                'unsupported percentage' => '![Alt](https://example.test/image.png "{width=51%}")',
                'unspaced marker'        => '![Alt](https://example.test/image.png "Title{width=50%}")',
                'adjacent markers'       => '![Alt](https://example.test/image.png "{width=50%}{width=67%}")',
                'repeated markers'       => '![Alt](https://example.test/image.png "Title {width=50%} {width=67%}")',
                'repeated bare markers'  => '![Alt](https://example.test/image.png "{width=50%} {width=67%}")',
                'trailing spaces repeat' => '![Alt](https://example.test/image.png "Title {width=50%}   {width=67%}")',
            ) as $case => $markdown
        ) {
            try {
                MarkdownRenderer::render( $markdown );
                $this->fail( 'Expected invalid terminal marker to throw for ' . $case );
            } catch ( RuntimeException $exception ) {
                $this->assertSame( 'easymde_image_scale_syntax_invalid', $exception->getMessage(), $case );
            }
        }
    }

    public function test_nonterminal_image_scale_text_in_title_stays_literal_and_supports_terminal_scale()
    {
        $literal_markdown = '![Alt](https://example.test/image.png "Syntax {width=50%} example")';
        $literal_html     = MarkdownRenderer::render( $literal_markdown );
        $literal_preview  = MarkdownRenderer::render_preview( $literal_markdown );

        foreach ( array( 'render' => $literal_html, 'render_preview' => $literal_preview['html'] ) as $mode => $html ) {
            $document              = new DOMDocument( '1.0', 'UTF-8' );
            $previous_libxml_state = libxml_use_internal_errors( true );
            try {
                $loaded = $document->loadHTML(
                    '<?xml encoding="UTF-8"><div id="image-scale-root">' . $html . '</div>',
                    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
                );
            } finally {
                libxml_clear_errors();
                libxml_use_internal_errors( $previous_libxml_state );
            }

            $this->assertTrue( $loaded, $mode );
            $image = $document->getElementsByTagName( 'img' )->item( 0 );
            $this->assertInstanceOf( DOMElement::class, $image, $mode );
            $this->assertSame( 'Syntax {width=50%} example', $image->getAttribute( 'title' ), $mode );
            $this->assertFalse( $image->hasAttribute( 'width' ), $mode );
            $this->assertFalse( $image->hasAttribute( 'data-easymde-image-scale' ), $mode );
        }

        $scaled_markdown = '![Alt](https://example.test/image.png "Syntax {width=50%} example {width=67%}")';
        $scaled_html     = MarkdownRenderer::render( $scaled_markdown );
        $scaled_preview  = MarkdownRenderer::render_preview( $scaled_markdown );

        foreach ( array( 'render' => $scaled_html, 'render_preview' => $scaled_preview['html'] ) as $mode => $html ) {
            $document              = new DOMDocument( '1.0', 'UTF-8' );
            $previous_libxml_state = libxml_use_internal_errors( true );
            try {
                $loaded = $document->loadHTML(
                    '<?xml encoding="UTF-8"><div id="image-scale-root">' . $html . '</div>',
                    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
                );
            } finally {
                libxml_clear_errors();
                libxml_use_internal_errors( $previous_libxml_state );
            }

            $this->assertTrue( $loaded, $mode );
            $image = $document->getElementsByTagName( 'img' )->item( 0 );
            $this->assertInstanceOf( DOMElement::class, $image, $mode );
            $this->assertSame( 'Syntax {width=50%} example', $image->getAttribute( 'title' ), $mode );
            $this->assertSame( '67%', $image->getAttribute( 'width' ), $mode );
            $this->assertSame( '67', $image->getAttribute( 'data-easymde-image-scale' ), $mode );
        }
    }

    public function test_preview_preserves_image_scale_contract()
    {
        $preview = MarkdownRenderer::render_preview(
            '![Alt text](https://example.test/image.png "Image title {width=150%}")'
        );

        $this->assertStringContainsString( 'alt="Alt text"', $preview['html'] );
        $this->assertStringContainsString( 'title="Image title"', $preview['html'] );
        $this->assertStringContainsString( 'width="150%"', $preview['html'] );
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

    public function test_task_list_marker_spacing_is_removed_from_tight_and_loose_lists()
    {
        $tight = MarkdownRenderer::render( "- [ ] Todo\n- [x] Done", 'default' );
        $loose = MarkdownRenderer::render( "- [ ] Todo\n\n- [x] Done", 'default' );

        // Real line breaks are required here: the two items must be separate
        // list entries so both checkbox states run through the spacing
        // normalization. An escaped '\n' would collapse them into one item.
        $this->assertSame( 2, substr_count( $tight, 'class="task-list-item"' ) );
        $this->assertStringContainsString( '<input disabled type="checkbox">Todo', $tight );
        $this->assertStringContainsString( '<input checked disabled type="checkbox">Done', $tight );
        $this->assertStringNotContainsString( '<input disabled type="checkbox"> Todo', $tight );
        $this->assertStringNotContainsString( '<input checked disabled type="checkbox"> Done', $tight );
        $this->assertSame( 2, substr_count( $loose, 'class="task-list-item"' ) );
        $this->assertStringContainsString( '<p><input disabled type="checkbox">Todo</p>', $loose );
        $this->assertStringContainsString( '<p><input checked disabled type="checkbox">Done</p>', $loose );
        $this->assertStringNotContainsString( '<input disabled type="checkbox"> Todo', $loose );
        $this->assertStringNotContainsString( '<input checked disabled type="checkbox"> Done', $loose );
    }

    public function test_task_marker_spacing_does_not_change_regular_lists_or_non_task_inputs()
    {
        $regular = MarkdownRenderer::render( "- Todo\n- Done", 'default' );
        $input   = MarkdownRenderer::render( 'Label <input type="checkbox" disabled> text', 'default' );

        $this->assertStringContainsString( '<li>Todo</li>', $regular );
        $this->assertStringContainsString( '<li>Done</li>', $regular );
        $this->assertStringNotContainsString( '<input', $input );
        $this->assertStringContainsString( 'Label', $input );
        $this->assertStringContainsString( 'text', $input );
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

    public function test_controlled_table_cell_break_is_only_the_exact_lowercase_token()
    {
        $renderers = array(
            'render'         => static function ( $markdown ) {
                return MarkdownRenderer::render( $markdown, 'default' );
            },
            'render_preview' => static function ( $markdown ) {
                $preview = MarkdownRenderer::render_preview( $markdown, 'default' );
                return $preview['html'];
            },
        );
        $shape = static function ( $html, $cell_index = 0 ) {
            $document              = new DOMDocument( '1.0', 'UTF-8' );
            $previous_libxml_state = libxml_use_internal_errors( true );
            try {
                $loaded = $document->loadHTML(
                    '<?xml encoding="UTF-8"><div id="table-break-root">' . $html . '</div>',
                    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
                );
            } finally {
                libxml_clear_errors();
                libxml_use_internal_errors( $previous_libxml_state );
            }
            $root = $document->getElementById( 'table-break-root' );
            if ( ! $loaded || ! $root instanceof DOMElement ) {
                return null;
            }
            $xpath = new DOMXPath( $document );
            $cell  = $xpath->query( '//th|//td' )->item( $cell_index );
            if ( ! $cell instanceof DOMElement ) {
                return null;
            }
            $children = array();
            foreach ( $cell->childNodes as $child ) {
                $children[] = array(
                    'type'  => $child->nodeType,
                    'name'  => strtolower( $child->nodeName ),
                    'text'  => $child->nodeType === XML_TEXT_NODE ? $child->nodeValue : null,
                    'attrs' => $child instanceof DOMElement ? $child->attributes->length : 0,
                );
            }
            return $children;
        };
        $assert_break = static function ( $html ) use ( $shape ) {
            $children = $shape( $html );
            if ( ! is_array( $children ) ) {
                return false;
            }
            foreach ( $children as $child ) {
                if ( 'br' !== $child['name'] ) {
                    continue;
                }
                return $child;
            }
            return false;
        };
        $assert_no_break = static function ( $html ) use ( $shape ) {
            $children = $shape( $html );
            if ( ! is_array( $children ) ) {
                return true;
            }
            foreach ( $children as $child ) {
                if ( 'br' === $child['name'] ) {
                    return false;
                }
            }
            return true;
        };

        foreach ( $renderers as $name => $render ) {
            $children = $shape( $render( "| A<br>B |\n| --- |\n" ) );
            $this->assertSame(
                array(
                    array( 'type' => XML_TEXT_NODE, 'name' => '#text', 'text' => 'A', 'attrs' => 0 ),
                    array( 'type' => XML_ELEMENT_NODE, 'name' => 'br', 'text' => null, 'attrs' => 0 ),
                    array( 'type' => XML_TEXT_NODE, 'name' => '#text', 'text' => 'B', 'attrs' => 0 ),
                ),
                $children,
                $name
            );
            $this->assertNotFalse( $assert_break( $render( "| A<br>B |\n| --- |\n" ) ) );

            foreach (
                array(
                    'paragraph'   => 'A<br>B',
                    'uppercase'   => "| A<BR>B |\n| --- |\n",
                    'self-closing'=> "| A<br/>B |\n| --- |\n",
                    'attributes'  => "| A<br class=\"x\">B |\n| --- |\n",
                    'code-span'   => "| `<br>` |\n| --- |\n",
                    'escaped'     => "| A\\<br>B |\n| --- |\n",
                    'entity'      => "| A&lt;br&gt;B |\n| --- |\n",
                    'dangerous'   => "| A<script>x</script>B |\n| --- |\n",
                ) as $case => $markdown
            ) {
                $this->assertTrue( $assert_no_break( $render( $markdown ) ), $name . ':' . $case );
            }
        }

        $adjacent = $renderers['render_preview']( "| A<br>B | C<br>D |\n| --- | --- |\n" );
        $this->assertNotFalse( $assert_break( $adjacent ) );
        $this->assertSame( array( 'A', 'B' ), array_values( array_map( static function ( $child ) {
            return $child['text'];
        }, array_filter( $shape( $adjacent, 0 ), static function ( $child ) {
            return null !== $child['text'];
        } ) ) ) );

        $quoted = $renderers['render_preview']( "> | A<br>B |\n> | --- |\n" );
        $this->assertNotFalse( $assert_break( $quoted ) );
    }

	/**
	 * @param array<string,mixed> $block
	 * @return array{startLine:int,endLine:int}
	 */
	private static function block_range( array $block ) {
		return array(
			'startLine' => $block['startLine'],
			'endLine'   => $block['endLine'],
		);
	}
}
