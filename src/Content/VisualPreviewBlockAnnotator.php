<?php

namespace EasyMDE\Content;

use DOMDocument;
use DOMElement;
use DOMNode;
use League\CommonMark\Node\Block\AbstractBlock;
use League\CommonMark\Node\Block\Document;
use League\CommonMark\Extension\CommonMark\Node\Inline\Image;
use League\CommonMark\Extension\CommonMark\Node\Inline\Link;
use RuntimeException;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Adds the source ranges required by the unlocked visual editing projection.
 *
 * The annotator never renders Markdown and never becomes a second persistence
 * owner. It only carries CommonMark block provenance through the existing
 * Preview HTML transformations and emits a privacy-safe sidecar.
 */
final class VisualPreviewBlockAnnotator {

	const SOURCE_ATTRIBUTE = 'data-easymde-visual-source-id';
	const BLOCK_ATTRIBUTE  = 'data-easymde-visual-block-id';

	/**
	 * @param array<int,array{start:int,end:int}> $line_map Optional transformed-line to source-line map.
	 * @return array<int, array{source_id:string,startLine:int,endLine:int,editable:bool}>
	 */
	public static function describe_source_blocks( Document $document, array $line_map = array() ) {
		$blocks = array();

		foreach ( $document->children() as $index => $node ) {
			if ( ! $node instanceof AbstractBlock ) {
				throw new RuntimeException( 'Unable to map a non-block CommonMark root node to Preview source lines.' );
			}

			$start_line = $node->getStartLine();
			$end_line   = $node->getEndLine();
			if ( null === $start_line || null === $end_line || $start_line < 1 || $end_line < $start_line ) {
				throw new RuntimeException( 'CommonMark did not provide a valid source range for a Preview block.' );
			}

			$range = empty( $line_map )
				? array(
					'startLine' => (int) $start_line - 1,
					'endLine'   => (int) $end_line,
				)
				: self::map_line_range( $start_line, $end_line, $line_map );

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
	 * @param array<int,array{start:int,end:int}> $line_map
	 * @return array{startLine:int,endLine:int}
	 */
	private static function map_line_range( $start_line, $end_line, array $line_map ) {
		$mapped_start = null;
		$mapped_end   = null;

		for ( $line = (int) $start_line; $line <= (int) $end_line; ++$line ) {
			if ( ! isset( $line_map[ $line ]['start'], $line_map[ $line ]['end'] ) ) {
				throw new RuntimeException( 'Preview transformed lines do not have complete source provenance.' );
			}

			$mapped_start = null === $mapped_start ? $line_map[ $line ]['start'] : min( $mapped_start, $line_map[ $line ]['start'] );
			$mapped_end   = null === $mapped_end ? $line_map[ $line ]['end'] : max( $mapped_end, $line_map[ $line ]['end'] );
		}

		if ( null === $mapped_start || null === $mapped_end || $mapped_start < 1 || $mapped_end < $mapped_start ) {
			throw new RuntimeException( 'Preview transformed lines produced an invalid source range.' );
		}

		return array(
			'startLine' => (int) $mapped_start - 1,
			'endLine'   => (int) $mapped_end,
		);
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

		$map = array();
		foreach ( $root_blocks as $index => $root_block ) {
			$source_ids = self::source_ids( $root_block );
			if ( empty( $source_ids ) && ! self::is_generated_root( $root_block ) ) {
				throw new RuntimeException( 'Preview HTML contains a root block without source provenance.' );
			}

			$range    = self::range_for_source_ids( $source_ids, $source_by_id );
			$editable = ! empty( $source_ids );

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
