<?php

use EasyMDE\Content\MarkdownRenderer;

final class TableAlignmentAnnotationTest extends WP_UnitTestCase
{
	private function marker( array $entries )
	{
		return '<!-- easymde-table-align:v1 ' . wp_json_encode( $entries ) . ' -->';
	}

	private function table( $body = '| A | B |\n| --- | --- |\n| x | y |' )
	{
		return str_replace( '\\n', "\n", $body );
	}

	public function test_formal_renderer_applies_row_then_cell_alignment_and_detaches_marker()
	{
		$markdown = $this->marker( array( array( 1, 'center' ), array( 1, 0, 'right' ) ) ) . "\n" . $this->table();
		$html     = MarkdownRenderer::render( $markdown );

		$this->assertStringNotContainsString( 'easymde-table-align', $html );
		$this->assertStringContainsString( '<td align="right" style="text-align:right">x</td>', $html );
		$this->assertStringContainsString( '<td align="center" style="text-align:center">y</td>', $html );
	}

	public function test_shared_fixture_cases_use_the_real_formal_converter()
	{
		$fixture = json_decode( file_get_contents( __DIR__ . '/../fixtures/table-alignment-annotation.json' ), true, 512, JSON_THROW_ON_ERROR );
		foreach ( $fixture['cases'] as $case ) {
			$html = MarkdownRenderer::render( $case['source'] );
			$this->assertStringContainsString( '<table>', $html, $case['id'] );
			$this->assertStringNotContainsString( 'easymde-table-align', $html, $case['id'] );

			$document = new DOMDocument( '1.0', 'UTF-8' );
			$previous_libxml_state = libxml_use_internal_errors( true );
			try {
				$loaded = $document->loadHTML( '<?xml encoding="UTF-8"><div id="fixture-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
			} finally {
				libxml_clear_errors();
				libxml_use_internal_errors( $previous_libxml_state );
			}
			$this->assertTrue( $loaded, $case['id'] );
			$table = $document->getElementsByTagName( 'table' )->item( 0 );
			$this->assertInstanceOf( DOMElement::class, $table, $case['id'] );
			$rows = $table->getElementsByTagName( 'tr' );
			$header_cells = $rows->item( 0 )->getElementsByTagName( 'th' );
			foreach ( $case['baseAlignments'] as $column => $alignment ) {
				if ( null === $alignment || 'left' === $alignment ) {
					continue;
				}
				$this->assertSame( $alignment, $header_cells->item( $column )->getAttribute( 'align' ), $case['id'] );
				$this->assertSame( 'text-align:' . $alignment, $header_cells->item( $column )->getAttribute( 'style' ), $case['id'] );
			}
			$expected_rows = array();
			$annotated_rows = array();
			for ( $row_index = 0; $row_index < $case['rowCount']; ++$row_index ) {
				$expected_rows[ $row_index ] = $case['baseAlignments'];
			}
			foreach ( $case['entries'] as $entry ) {
				if ( 2 === count( $entry ) ) {
					$expected_rows[ $entry[0] ] = array_fill( 0, $case['columnCount'], $entry[1] );
					$annotated_rows[ $entry[0] ] = true;
				}
			}
			foreach ( $case['entries'] as $entry ) {
				if ( 3 === count( $entry ) ) {
					$expected_rows[ $entry[0] ][ $entry[1] ] = $entry[2];
					$annotated_rows[ $entry[0] ] = true;
				}
			}
			foreach ( $expected_rows as $row_index => $row_alignments ) {
				if ( 0 === $row_index || empty( $annotated_rows[ $row_index ] ) ) {
					continue;
				}
				foreach ( $row_alignments as $column => $alignment ) {
					$this->assertSame( $alignment, $rows->item( $row_index )->getElementsByTagName( 'td' )->item( $column )->getAttribute( 'align' ), $case['id'] );
				}
			}
		}
	}

	public function test_shared_fixture_invalid_payloads_use_real_converter_failures()
	{
		$fixture = json_decode( file_get_contents( __DIR__ . '/../fixtures/table-alignment-annotation.json' ), true, 512, JSON_THROW_ON_ERROR );
		$source_table = "| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |";
		foreach ( $fixture['invalidPayloads'] as $case ) {
			$marker = isset( $case['marker'] )
				? $case['marker']
				: '<!-- easymde-table-align:v1 ' . wp_json_encode( $case['entries'] ) . ' -->';
			if ( 'orphan-marker' === $case['id'] ) {
				$source = $marker;
			} elseif ( 'indented-code-marker' === $case['id'] ) {
				$html = MarkdownRenderer::render( $marker . "\n" . $source_table );
				$this->assertStringContainsString( 'easymde-table-align:v1', $html, $case['id'] );
				$this->assertStringNotContainsString( 'align="center"', $html, $case['id'] );
				continue;
			} else {
				$source = $marker . "\n" . ( 'same-value-row' === $case['id'] ? str_replace( '| --- | ---: |', '| :--- | :--- |', $source_table ) : $source_table );
			}

			try {
				MarkdownRenderer::render( $source );
				$this->fail( 'Expected shared invalid fixture to fail: ' . $case['id'] );
			} catch ( RuntimeException $exception ) {
				$expected_code = isset( $case['expectedCode'] )
					? $case['expectedCode']
					: array(
						'invalid-version'  => 'table-alignment-annotation-marker-invalid',
						'multiline-marker' => 'table-alignment-annotation-marker-invalid',
						'duplicate-row'   => 'table-alignment-annotation-entry-order-invalid',
						'duplicate-cell'  => 'table-alignment-annotation-entry-order-invalid',
						'out-of-range-row' => 'table-alignment-annotation-entry-invalid',
						'out-of-range-column' => 'table-alignment-annotation-entry-invalid',
						'unsorted-tuples' => 'table-alignment-annotation-entry-order-invalid',
						'wrong-shape' => 'table-alignment-annotation-entry-invalid',
						'cell-without-row' => 'table-alignment-annotation-entry-redundant',
						'same-value-row' => 'table-alignment-annotation-entry-redundant',
						'same-value-cell' => 'table-alignment-annotation-entry-redundant',
						'json-object' => 'table-alignment-annotation-entry-invalid',
						'tuple-object' => 'table-alignment-annotation-entry-invalid',
					)[ $case['id'] ];
				$this->assertSame( $expected_code, $exception->getMessage(), $case['id'] );
			}
		}
	}

	public function test_preview_edit_map_includes_annotation_prefix_with_crlf()
	{
		$markdown = $this->marker( array( array( 1, 'center' ) ) ) . "\r\n" . str_replace( "\n", "\r\n", $this->table() ) . "\r\n";
		$preview  = MarkdownRenderer::render_preview( $markdown );

		$this->assertStringNotContainsString( 'easymde-table-align', $preview['html'] );
		$this->assertSame( 0, $preview['editMap']['blocks'][0]['startLine'] );
		$this->assertSame( 4, $preview['editMap']['blocks'][0]['endLine'] );
	}

	public function test_two_identical_tables_keep_their_own_annotation()
	{
		$markdown = $this->marker( array( array( 1, 'center' ) ) ) . "\n" . $this->table() . "\n\n"
			. $this->marker( array( array( 1, 'right' ) ) ) . "\n" . $this->table();
		$html = MarkdownRenderer::render( $markdown );

		$this->assertSame( 2, substr_count( $html, '<table>' ) );
		$this->assertSame( 1, substr_count( $html, '<td align="center" style="text-align:center">y</td>' ) );
		$this->assertSame( 1, substr_count( $html, '<td align="right" style="text-align:right">y</td>' ) );
	}

	public function test_code_marker_is_literal_and_does_not_activate_annotation()
	{
		$html = MarkdownRenderer::render( "```markdown\n" . $this->marker( array( array( 1, 'center' ) ) ) . "\n```" );

		$this->assertStringContainsString( 'easymde-table-align:v1', $html );
		$this->assertStringNotContainsString( '<table>', $html );
	}

	public function test_four_space_and_tab_prefixes_remain_indented_code()
	{
		foreach ( array( '    ', "\t" ) as $prefix ) {
			$html = MarkdownRenderer::render( $prefix . $this->marker( array( array( 1, 'center' ) ) ) . "\n" . $this->table() );

			$this->assertStringContainsString( 'easymde-table-align:v1', $html );
			$this->assertStringNotContainsString( 'align="center"', $html );
		}
	}

	public function test_ordinary_comment_policy_remains_unchanged()
	{
		$html = MarkdownRenderer::render( "<!-- ordinary comment -->\n\n" . $this->table() );

		$this->assertStringNotContainsString( 'ordinary comment', $html );
		$this->assertStringContainsString( '<table>', $html );
	}

	/**
	 * @dataProvider invalid_marker_provider
	 */
	public function test_reserved_invalid_markers_fail_explicitly( $marker, $code )
	{
		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( $code );
		MarkdownRenderer::render( $marker . "\n" . $this->table() );
	}

	public function invalid_marker_provider()
	{
		return array(
			array( '<!-- easymde-table-align:v1 nope -->', 'table-alignment-annotation-marker-invalid' ),
			array( '<!-- easymde-table-align:v2 [[1,"center"]] -->', 'table-alignment-annotation-marker-invalid' ),
			array( '<!-- easymde-table-align:v1 [[1,"center"],[1,"center"]] -->', 'table-alignment-annotation-entry-order-invalid' ),
			array( '<!-- easymde-table-align:v1 [[4,"center"]] -->', 'table-alignment-annotation-entry-invalid' ),
			array( '<!-- easymde-table-align:v1 [[1,0,"center"]] -->', 'table-alignment-annotation-entry-redundant' ),
		);
	}

	public function test_orphan_and_non_adjacent_markers_fail_explicitly()
	{
		foreach ( array(
			$this->marker( array( array( 1, 'center' ) ) ),
			$this->marker( array( array( 1, 'center' ) ) ) . "\n\n" . $this->table(),
		) as $markdown ) {
			try {
				MarkdownRenderer::render( $markdown );
				$this->fail( 'Expected a reserved orphan marker to fail.' );
			} catch ( RuntimeException $exception ) {
				$this->assertSame( 'table-alignment-annotation-marker-orphan', $exception->getMessage() );
			}
		}
	}

	public function test_oversized_reserved_marker_fails_before_json_processing()
	{
		$marker = '<!-- easymde-table-align:v1 "' . str_repeat( 'x', 4100 ) . '" -->';

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'table-alignment-annotation-marker-too-large' );
		MarkdownRenderer::render( $marker . "\n" . $this->table() );
	}

	public function test_json_objects_are_not_accepted_as_array_tuples()
	{
		foreach ( array(
			'<!-- easymde-table-align:v1 {"0":[1,"center"]} -->',
			'<!-- easymde-table-align:v1 [{"0":1,"1":"center"}] -->',
		) as $marker ) {
			try {
				MarkdownRenderer::render( $marker . "\n" . $this->table() );
				$this->fail( 'Expected JSON objects to be rejected.' );
			} catch ( RuntimeException $exception ) {
				$this->assertSame( 'table-alignment-annotation-entry-invalid', $exception->getMessage() );
			}
		}
	}

	public function test_integral_float_coordinates_are_normalized_before_tuple_identity_checks()
	{
		$markdown = $this->marker( array( array( 1.0, 'left' ), array( 1, 0, 'center' ) ) ) . "\n"
			. "| A | B |\n| --- | ---: |\n| x | y |";
		$html = MarkdownRenderer::render( $markdown );

		$this->assertStringContainsString( '<td align="center" style="text-align:center">x</td>', $html );
		$this->assertStringContainsString( '<td align="left" style="text-align:left">y</td>', $html );
	}

	public function test_base_equal_row_anchor_is_retained_when_it_has_a_cell_exception()
	{
		$markdown = $this->marker( array( array( 1, 'left' ), array( 1, 0, 'center' ) ) ) . "\n"
			. "| A | B |\n| :--- | ---: |\n| x | y |";
		$html = MarkdownRenderer::render( $markdown );

		$this->assertStringContainsString( '<td align="center" style="text-align:center">x</td>', $html );
		$this->assertStringContainsString( '<td align="left" style="text-align:left">y</td>', $html );
	}

	public function test_bare_table_row_left_override_emits_explicit_header_and_body_alignment()
	{
		$markdown = $this->marker( array( array( 0, 'left' ), array( 1, 'left' ) ) ) . "\n" . $this->table();
		$html     = MarkdownRenderer::render( $markdown );

		$this->assertStringContainsString( '<th align="left" style="text-align:left">A</th>', $html );
		$this->assertStringContainsString( '<td align="left" style="text-align:left">x</td>', $html );
	}

	public function test_bare_table_without_annotation_keeps_natural_alignment_markup_free()
	{
		$html = MarkdownRenderer::render( $this->table() );

		$this->assertStringNotContainsString( 'align="', $html );
		$this->assertStringNotContainsString( 'text-align:', $html );
	}

	public function test_multiline_reserved_marker_is_rejected()
	{
		$marker = "<!-- easymde-table-align:v1 [[1,\"center\"]]\ncontinued -->";

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'table-alignment-annotation-marker-invalid' );
		MarkdownRenderer::render( $marker . "\n" . $this->table() );
	}

	public function test_raw_html_remains_stripped_and_does_not_create_a_table_annotation()
	{
		$html = MarkdownRenderer::render( "<div>raw</div>\n\n" . $this->table() );

		$this->assertStringNotContainsString( '<div>', $html );
		$this->assertStringContainsString( '<table>', $html );
	}
}
