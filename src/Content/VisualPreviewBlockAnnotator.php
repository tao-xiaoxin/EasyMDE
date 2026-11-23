<?php

namespace EasyMDE\Content;

use DOMDocument;
use DOMElement;
use DOMNode;
use League\CommonMark\Node\Block\AbstractBlock;
use League\CommonMark\Node\Block\Document;
use League\CommonMark\Extension\CommonMark\Node\Inline\Image;
use League\CommonMark\Extension\CommonMark\Node\Inline\Link;
use League\CommonMark\Extension\Table\Table;
use League\CommonMark\Extension\Table\TableRow;
use League\CommonMark\Extension\Table\TableSection;
use League\CommonMark\Node\Block\Paragraph;
use RuntimeException;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Adds the source ranges required by the unlocked visual editing projection.
 *
 * The annotator never renders Markdown and never becomes a second persistence
 * owner. It only carries CommonMark block provenance through the existing
 * Preview HTML transformations and emits a privacy-safe sidecar. Code-body
 * and code-projection provenance is built by VisualPreviewCodeProjectionBuilder
 * and exposed here unchanged for existing callers.
 */
final class VisualPreviewBlockAnnotator {

	const SOURCE_ATTRIBUTE            = 'data-easymde-visual-source-id';
	const BLOCK_ATTRIBUTE             = 'data-easymde-visual-block-id';
	const MAX_CODE_BODY_ENTRIES       = VisualPreviewCodeProjectionBuilder::MAX_CODE_BODY_ENTRIES;
	const MAX_CODE_BODY_BYTES         = VisualPreviewCodeProjectionBuilder::MAX_CODE_BODY_BYTES;
	const CODE_BODY_UNAVAILABLE       = VisualPreviewCodeProjectionBuilder::CODE_BODY_UNAVAILABLE;
	const CODE_BODY_LIMIT             = VisualPreviewCodeProjectionBuilder::CODE_BODY_LIMIT;
	const MAX_CODE_PROJECTION_ENTRIES = VisualPreviewCodeProjectionBuilder::MAX_CODE_PROJECTION_ENTRIES;
	const MAX_CODE_PROJECTION_ROWS    = VisualPreviewCodeProjectionBuilder::MAX_CODE_PROJECTION_ROWS;
	const MAX_CODE_PROJECTION_BYTES   = VisualPreviewCodeProjectionBuilder::MAX_CODE_PROJECTION_BYTES;
	const MAX_CODE_PROJECTION_INFO    = VisualPreviewCodeProjectionBuilder::MAX_CODE_PROJECTION_INFO;

	/**
	 * @param array<int,array{start:int,end:int}> $line_map           Optional transformed-line to source-line map.
	 * @param string                              $normalized_markdown Optional parsed Markdown used to verify one repaired range.
	 * @return array<int, array{source_id:string,startLine:int,endLine:int,editable:bool}>
	 */
	public static function describe_source_blocks( Document $document, array $line_map = array(), $normalized_markdown = '' ) {
		$blocks = array();
		$nodes  = array();

		foreach ( $document->children() as $node ) {
			if ( ! $node instanceof AbstractBlock ) {
				throw new RuntimeException( 'Unable to map a non-block CommonMark root node to Preview source lines.' );
			}

			$nodes[] = $node;
		}

		$repaired = self::repair_split_table_ranges(
			$nodes,
			'' === (string) $normalized_markdown ? array() : VisualPreviewCodeProjectionBuilder::split_source_lines( $normalized_markdown )
		);

		foreach ( $nodes as $index => $node ) {
			$start_line = $node->getStartLine();
			$end_line   = $node->getEndLine();
			if ( isset( $repaired[ $index ] ) ) {
				$start_line = $repaired[ $index ][0];
				$end_line   = $repaired[ $index ][1];
			} elseif ( null === $start_line || null === $end_line || $start_line < 1 || $end_line < $start_line ) {
				throw new RuntimeException( 'CommonMark did not provide a valid source range for a Preview block.' );
			}
			if ( $node instanceof Table ) {
				$prefix_start = TableAlignmentAnnotation::source_prefix_start_line( $node );
				if ( null !== $prefix_start && $prefix_start < $start_line ) {
					$start_line = $prefix_start;
				}
			}

			$range = empty( $line_map )
				? array(
					'startLine' => (int) $start_line - 1,
					'endLine'   => (int) $end_line,
				)
				: VisualPreviewCodeProjectionBuilder::map_line_range( $start_line, $end_line, $line_map );

			$blocks[] = array(
				'source_id' => 's' . (int) $index,
				'startLine' => $range['startLine'],
				'endLine'   => $range['endLine'],
				'editable'  => true,
			);
		}

		return $blocks;
	}

	/**
	 * Repair the source ranges CommonMark reports when a GFM table start parser
	 * replaces the active paragraph parser.
	 *
	 * TableStartParser gives the replaced paragraph's start line to both the
	 * surviving paragraph and the new table, then closes that paragraph at
	 * start - 1. A valid paragraph-adjacent table stays contiguous: the paragraph
	 * owns the text lines before the header row, the table owns the header,
	 * delimiter, and body lines. The delimiter row comes from the table's own body
	 * rows and is verified against the parsed Markdown, so every other invalid
	 * range keeps failing closed.
	 *
	 * @param array<int,AbstractBlock>                       $nodes            Root blocks in document order.
	 * @param array<int,array{content:string,ending:string}> $normalized_lines Parsed Markdown lines, empty to skip verification.
	 * @return array<int,array{0:int,1:int}> Repaired inclusive 1-indexed ranges keyed by root block index.
	 */
	private static function repair_split_table_ranges( array $nodes, array $normalized_lines ) {
		$ranges = array();

		foreach ( $nodes as $index => $node ) {
			$start_line = $node->getStartLine();
			$end_line   = $node->getEndLine();
			if ( ! $node instanceof Paragraph || ! isset( $nodes[ $index + 1 ] ) || ! $nodes[ $index + 1 ] instanceof Table ) {
				continue;
			}

			$table       = $nodes[ $index + 1 ];
			$table_start = $table->getStartLine();
			$table_end   = $table->getEndLine();
			if ( null === $start_line || null === $end_line || null === $table_start || null === $table_end ) {
				continue;
			}
			if ( $start_line < 1 || $end_line !== $start_line - 1 || $table_start !== $start_line ) {
				continue;
			}

			$delimiter_line = $table_end - self::table_body_row_count( $table );
			if ( $delimiter_line < $start_line + 2 || $delimiter_line > $table_end ) {
				continue;
			}
			if ( ! self::is_table_delimiter_line( $delimiter_line, $normalized_lines ) ) {
				continue;
			}

			$ranges[ $index ]     = array( $start_line, $delimiter_line - 2 );
			$ranges[ $index + 1 ] = array( $delimiter_line - 1, $table_end );
		}

		return $ranges;
	}

	/**
	 * Count the table body rows the table parser accepted into the AST.
	 */
	private static function table_body_row_count( Table $table ) {
		$count = 0;

		foreach ( $table->children() as $section ) {
			if ( ! $section instanceof TableSection || $section->isHead() ) {
				continue;
			}

			foreach ( $section->children() as $row ) {
				if ( $row instanceof TableRow ) {
					++$count;
				}
			}
		}

		return $count;
	}

	/**
	 * Confirm the derived line is a GFM table delimiter row.
	 *
	 * @param int                                            $line_number      1-indexed candidate delimiter line.
	 * @param array<int,array{content:string,ending:string}> $normalized_lines Parsed Markdown lines, empty to skip verification.
	 */
	private static function is_table_delimiter_line( $line_number, array $normalized_lines ) {
		if ( empty( $normalized_lines ) ) {
			return true;
		}
		if ( ! isset( $normalized_lines[ $line_number - 1 ] ) ) {
			return false;
		}

		$content = $normalized_lines[ $line_number - 1 ]['content'];
		if ( false === strpos( $content, '|' ) ) {
			return false;
		}

		return 1 === preg_match( '/^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/D', $content );
	}

	/**
	 * Build the source-backed code-body map from the same parsed Preview AST.
	 *
	 * CommonMark's code literal is authoritative for content characters. The
	 * source line map supplies original line endings and verifies that theme
	 * normalization did not change a code row before it is exposed to REST.
	 *
	 * @param array<int,array{start:int,end:int}> $line_map
	 * @return array{version:int,coordinate:string,status:string,entries:array<int,array<string,mixed>>}|null
	 */
	public static function describe_source_code_bodies( Document $document, $normalized_markdown, array $line_map, $original_markdown ) {
		return VisualPreviewCodeProjectionBuilder::describe_source_code_bodies( $document, $normalized_markdown, $line_map, $original_markdown );
	}

	/**
	 * Build the source cursor projection observed by the CommonMark code parsers.
	 *
	 * This is raw source provenance, not rendered HTML or a persistence format.
	 * A malformed row makes only its entry unavailable; parser and Preview HTML
	 * remain authoritative and continue to be returned.
	 *
	 * @param array<int,array{start:int,end:int}> $line_map
	 * @param CodeProjectionBudget|null           $budget
	 * @return array<string,mixed>|null
	 */
	public static function describe_source_code_projections( Document $document, $normalized_markdown, array $line_map, $original_markdown, $budget = null ) {
		return VisualPreviewCodeProjectionBuilder::describe_source_code_projections( $document, $normalized_markdown, $line_map, $original_markdown, $budget );
	}

	/**
	 * Preserve the historical serializer entry point used by unit coverage.
	 *
	 * @param array<string,mixed> $projection
	 * @return string|false
	 */
	private static function encode_code_projection( array $projection ) {
		return VisualPreviewCodeProjectionBuilder::encode_code_projection( $projection );
	}

	/**
	 * Attach request-local source markers to the normalized AST before HTML
	 * rendering. A changed root-block sequence is ambiguous and is rejected.
	 *
	 * @param array<int, array{source_id:string,startLine:int,endLine:int,editable:bool}> $source_blocks
	 */
	public static function mark_document( Document $document, array $source_blocks ) {
		$nodes = array();
		foreach ( $document->children() as $node ) {
			$nodes[] = $node;
		}
		if ( count( $nodes ) !== count( $source_blocks ) ) {
			throw new RuntimeException( 'Unable to safely migrate Preview source ranges after Markdown normalization.' );
		}

		foreach ( $nodes as $index => $node ) {
			if ( ! $node instanceof AbstractBlock || ! isset( $source_blocks[ $index ]['source_id'] ) ) {
				throw new RuntimeException( 'Unable to attach a deterministic Preview source marker.' );
			}

			$source_id = (string) $source_blocks[ $index ]['source_id'];
			$node->data->set( 'attributes/' . self::SOURCE_ATTRIBUTE, $source_id );
			self::mark_first_media_child( $node, $source_id );
		}
	}

	/**
	 * @param array<int, array{source_id:string,startLine:int,endLine:int,editable:bool}> $source_blocks
	 * @return array{html:string,editMap:array{version:int,coordinate:string,blocks:array<int,array{id:string,startLine:int,endLine:int,editable:bool}>}}
	 */
	public static function finalize( $html, array $source_blocks ) {
		$html = (string) $html;
		if ( ! class_exists( 'DOMDocument' ) ) {
			throw new RuntimeException( 'The DOM extension is required to annotate Preview blocks.' );
		}

		$source_by_id = array();
		foreach ( $source_blocks as $source_block ) {
			if ( ! isset( $source_block['source_id'], $source_block['startLine'], $source_block['endLine'], $source_block['editable'] ) ) {
				throw new RuntimeException( 'Preview source map contains an incomplete source block.' );
			}

			$source_by_id[ $source_block['source_id'] ] = $source_block;
		}

		$document              = new DOMDocument( '1.0', 'UTF-8' );
		$previous_libxml_state = libxml_use_internal_errors( true );
		try {
			$loaded = $document->loadHTML(
				'<?xml encoding="UTF-8"><div id="easymde-visual-preview-root">' . $html . '</div>',
				LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
			);
		} finally {
			libxml_clear_errors();
			libxml_use_internal_errors( $previous_libxml_state );
		}

		if ( ! $loaded ) {
			throw new RuntimeException( 'Unable to parse sanitized Preview HTML for block annotation.' );
		}

		$root = $document->getElementById( 'easymde-visual-preview-root' );
		if ( ! $root instanceof DOMElement ) {
			throw new RuntimeException( 'Unable to locate the sanitized Preview HTML root for block annotation.' );
		}

		$root_blocks = array();
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		foreach ( $root->childNodes as $child ) {
			if ( $child instanceof DOMElement ) {
				$root_blocks[] = $child;
				continue;
			}

			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
			if ( $child instanceof DOMNode && '' !== trim( (string) $child->textContent ) ) {
				throw new RuntimeException( 'Preview HTML contains an unmappable root text node.' );
			}
		}

		$map           = array();
		$last_end_line = 0;
		foreach ( $root_blocks as $index => $root_block ) {
			$source_ids = self::source_ids( $root_block );
			if ( empty( $source_ids ) && ! self::is_generated_root( $root_block ) ) {
				throw new RuntimeException( 'Preview HTML contains a root block without source provenance.' );
			}

			$range         = empty( $source_ids )
				? array(
					'startLine' => $last_end_line,
					'endLine'   => $last_end_line,
				)
					: self::range_for_source_ids( $source_ids, $source_by_id );
			$editable      = ! empty( $source_ids );
			$last_end_line = $range['endLine'];

			$block_id = 'b' . (int) $index;
			$root_block->removeAttribute( self::BLOCK_ATTRIBUTE );
			$root_block->setAttribute( self::BLOCK_ATTRIBUTE, $block_id );
			$map[] = array(
				'id'        => $block_id,
				'startLine' => $range['startLine'],
				'endLine'   => $range['endLine'],
				'editable'  => (bool) $editable,
			);
		}

		self::remove_source_attributes( $root );

		$annotated_html = '';
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		foreach ( $root->childNodes as $child ) {
			$node_html = $document->saveHTML( $child );
			if ( false === $node_html ) {
				throw new RuntimeException( 'Unable to serialize annotated Preview HTML.' );
			}

			$annotated_html .= $node_html;
		}

		return array(
			'html'    => $annotated_html,
			'editMap' => array(
				'version'    => 1,
				'coordinate' => 'line',
				'blocks'     => $map,
			),
		);
	}

	private static function mark_first_media_child( AbstractBlock $node, $source_id ) {
		if ( ! $node->firstChild() instanceof Image && ! $node->firstChild() instanceof Link ) {
			return;
		}

		$child = $node->firstChild();
		if ( $child instanceof Image || $child instanceof Link ) {
			$child->data->set( 'attributes/' . self::SOURCE_ATTRIBUTE, $source_id );
		}
	}

	/**
	 * @return array<int,string>
	 */
	private static function source_ids( DOMElement $element ) {
		$ids = array();
		self::collect_source_ids( $element, $ids );

		return array_values( array_unique( $ids ) );
	}

	/**
	 * @param array<int,string> $ids
	 */
	private static function collect_source_ids( DOMElement $element, array &$ids ) {
		if ( $element->hasAttribute( self::SOURCE_ATTRIBUTE ) ) {
			$source_id = $element->getAttribute( self::SOURCE_ATTRIBUTE );
			if ( ! preg_match( '/^s[0-9]+$/', $source_id ) ) {
				throw new RuntimeException( 'Preview HTML contains an invalid source provenance marker.' );
			}
			$ids[] = $source_id;
		}

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		foreach ( $element->childNodes as $child ) {
			if ( $child instanceof DOMElement ) {
				self::collect_source_ids( $child, $ids );
			}
		}
	}

	/**
	 * @param array<int,string> $source_ids
	 * @param array<string,array{source_id:string,startLine:int,endLine:int,editable:bool}> $source_by_id
	 * @return array{startLine:int,endLine:int}
	 */
	private static function range_for_source_ids( array $source_ids, array $source_by_id ) {
		if ( empty( $source_ids ) ) {
			return array(
				'startLine' => 0,
				'endLine'   => 0,
			);
		}

		$start_line = null;
		$end_line   = null;
		foreach ( $source_ids as $source_id ) {
			if ( ! isset( $source_by_id[ $source_id ] ) ) {
				throw new RuntimeException( 'Preview HTML references a source block that is not present in the source map.' );
			}

			$source_block = $source_by_id[ $source_id ];
			$start_line   = null === $start_line ? $source_block['startLine'] : min( $start_line, $source_block['startLine'] );
			$end_line     = null === $end_line ? $source_block['endLine'] : max( $end_line, $source_block['endLine'] );
		}

		return array(
			'startLine' => (int) $start_line,
			'endLine'   => (int) $end_line,
		);
	}

	private static function is_generated_root( DOMElement $element ) {
		$classes = preg_split( '/\s+/', trim( (string) $element->getAttribute( 'class' ) ) );
		foreach ( array( 'easymde-toc', 'footnotes', 'footnotes-sep' ) as $generated_class ) {
			if ( in_array( $generated_class, $classes, true ) ) {
				return true;
			}
		}

		foreach ( array( 'block-1', 'block-2', 'block-3', 'column', 'column-left', 'column-right' ) as $container_class ) {
			if ( in_array( $container_class, $classes, true ) ) {
				return true;
			}
		}

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		if ( 'h2' === strtolower( $element->tagName ) && self::direct_child_with_class( $element, 'content' ) ) {
			return true;
		}

		return false;
	}

	private static function direct_child_with_class( DOMElement $element, $class_name ) {
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		foreach ( $element->childNodes as $child ) {
			if ( ! $child instanceof DOMElement ) {
				continue;
			}

			$classes = preg_split( '/\s+/', trim( (string) $child->getAttribute( 'class' ) ) );
			if ( in_array( $class_name, $classes, true ) ) {
				return true;
			}
		}

		return false;
	}

	private static function remove_source_attributes( DOMElement $root ) {
		if ( $root->hasAttribute( self::SOURCE_ATTRIBUTE ) ) {
			$root->removeAttribute( self::SOURCE_ATTRIBUTE );
		}

		$elements = array();
		foreach ( $root->getElementsByTagName( '*' ) as $element ) {
			$elements[] = $element;
		}

		foreach ( $elements as $element ) {
			if ( $element instanceof DOMElement && $element->hasAttribute( self::SOURCE_ATTRIBUTE ) ) {
				$element->removeAttribute( self::SOURCE_ATTRIBUTE );
			}
		}
	}
}
