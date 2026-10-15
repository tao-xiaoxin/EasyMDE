<?php

namespace EasyMDE\Content;

use DOMDocument;
use DOMElement;
use DOMNode;
use League\CommonMark\Extension\CommonMark\Node\Block\FencedCode;
use League\CommonMark\Extension\CommonMark\Node\Block\IndentedCode;
use League\CommonMark\Node\Block\AbstractBlock;
use League\CommonMark\Node\Block\Document;
use League\CommonMark\Extension\CommonMark\Node\Inline\Image;
use League\CommonMark\Extension\CommonMark\Node\Inline\Link;
use League\CommonMark\Extension\Table\Table;
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

	const SOURCE_ATTRIBUTE            = 'data-easymde-visual-source-id';
	const BLOCK_ATTRIBUTE             = 'data-easymde-visual-block-id';
	const MAX_CODE_BODY_ENTRIES       = 50000;
	const MAX_CODE_BODY_BYTES         = 4194304;
	const CODE_BODY_UNAVAILABLE       = 'preview-code-body-source-unavailable';
	const CODE_BODY_LIMIT             = 'preview-code-body-limit';
	const MAX_CODE_PROJECTION_ENTRIES = 50000;
	const MAX_CODE_PROJECTION_ROWS    = 50000;
	const MAX_CODE_PROJECTION_BYTES   = 4194304;
	const MAX_CODE_PROJECTION_INFO    = 1024;

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
		$nodes = array();
		self::collect_source_code_nodes( $document, $nodes );
		if ( empty( $nodes ) ) {
			return null;
		}

		if ( count( $nodes ) > self::MAX_CODE_BODY_ENTRIES ) {
			return self::unavailable_code_map( self::CODE_BODY_LIMIT );
		}

		$normalized_lines = self::split_source_lines( $normalized_markdown );
		$original_lines   = self::split_source_lines( $original_markdown );
		$entries          = array();
		$total_bytes      = 0;

		foreach ( $nodes as $node ) {
			$kind       = $node instanceof FencedCode ? 'fenced' : 'indented';
			$start_line = $node->getStartLine();
			$end_line   = $node->getEndLine();
			$range      = null;

			if ( null !== $start_line && null !== $end_line && $start_line >= 1 && $end_line >= $start_line ) {
				try {
					$range = self::map_line_range( $start_line, $end_line, $line_map );
				} catch ( RuntimeException $exception ) {
					$range = null;
				}
			}

			$entry_start  = null !== $range ? $range['startLine'] : max( 0, (int) $start_line - 1 );
			$entry_end    = null !== $range ? $range['endLine'] : max( $entry_start, (int) $end_line );
			$literal      = (string) $node->getLiteral();
			$literal_rows = self::code_literal_rows( $literal );
			$content      = '';
			$available    = null !== $range;

			if ( $available && ! empty( $literal_rows ) ) {
				$body_start_line = (int) $start_line + ( 'fenced' === $kind ? 1 : 0 );
				$previous_source = null;
				$content_rows    = array();

				foreach ( $literal_rows as $index => $literal_row ) {
					$normalized_line_number = $body_start_line + $index;
					if (
						$normalized_line_number > (int) $end_line
						||
						! isset( $line_map[ $normalized_line_number ]['start'], $line_map[ $normalized_line_number ]['end'] )
						|| $line_map[ $normalized_line_number ]['start'] !== $line_map[ $normalized_line_number ]['end']
						|| ( null !== $previous_source && $line_map[ $normalized_line_number ]['start'] !== $previous_source + 1 )
					) {
						$available = false;
						break;
					}

					$source_line_number = (int) $line_map[ $normalized_line_number ]['start'];
					$source_index       = $source_line_number - 1;
					if ( ! isset( $normalized_lines[ $normalized_line_number - 1 ], $original_lines[ $source_index ] ) ) {
						$available = false;
						break;
					}
					if ( $normalized_lines[ $normalized_line_number - 1 ]['content'] !== $original_lines[ $source_index ]['content'] ) {
						$available = false;
						break;
					}

					$content_rows[]  = $literal_row . $original_lines[ $source_index ]['ending'];
					$previous_source = $source_line_number;
				}

				if ( $available ) {
					$content = implode( '', $content_rows );
				}
			}

			if ( ! $available ) {
				$entries[] = array(
					'kind'      => $kind,
					'startLine' => $entry_start,
					'endLine'   => $entry_end,
					'status'    => 'unavailable',
					'code'      => self::CODE_BODY_UNAVAILABLE,
				);
				continue;
			}

			$total_bytes += strlen( $content );
			if ( $total_bytes > self::MAX_CODE_BODY_BYTES ) {
				return self::unavailable_code_map( self::CODE_BODY_LIMIT );
			}

			$entries[] = array(
				'kind'      => $kind,
				'startLine' => $entry_start,
				'endLine'   => $entry_end,
				'status'    => 'available',
				'content'   => $content,
			);
		}

		return array(
			'version'    => 1,
			'coordinate' => 'line',
			'status'     => 'available',
			'entries'    => $entries,
		);
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
		if ( $budget instanceof CodeProjectionBudget && $budget->is_limited() ) {
			return self::unavailable_code_projection( 'preview-code-projection-limit' );
		}

		$nodes = array();
		self::collect_source_code_nodes( $document, $nodes );
		if ( empty( $nodes ) ) {
			return null;
		}

		if ( count( $nodes ) > self::MAX_CODE_PROJECTION_ENTRIES ) {
			return self::unavailable_code_projection( 'preview-code-projection-limit' );
		}

		$normalized_lines = self::split_source_lines( $normalized_markdown );
		$original_lines   = self::split_source_lines( $original_markdown );
		$entries          = array();
		$row_count        = 0;

		foreach ( $nodes as $node ) {
			$kind       = $node instanceof FencedCode ? 'fenced' : 'indented';
			$start_line = $node->getStartLine();
			$end_line   = $node->getEndLine();
			$range      = null;
			if ( null !== $start_line && null !== $end_line && $start_line >= 1 && $end_line >= $start_line ) {
				try {
					$range = self::map_line_range( $start_line, $end_line, $line_map );
				} catch ( RuntimeException $exception ) {
					$range = null;
				}
			}

			$entry_start = null !== $range ? $range['startLine'] : max( 0, (int) $start_line - 1 );
			$entry_end   = null !== $range ? $range['endLine'] : max( $entry_start, (int) $end_line );
			$entry       = array(
				'kind'      => $kind,
				'startLine' => $entry_start,
				'endLine'   => $entry_end,
				'status'    => 'available',
			);
			$metadata    = $node->data->get( CodeProjectionParser::DATA_KEY );
			$available   = null !== $range && is_array( $metadata ) && isset( $metadata['rows'] ) && is_array( $metadata['rows'] );

			if ( 'fenced' === $kind ) {
				$info = (string) $node->getInfo();
				if ( strlen( $info ) > self::MAX_CODE_PROJECTION_INFO ) {
					$available       = false;
					$entry['status'] = 'unavailable';
					$entry['code']   = 'preview-code-projection-info-limit';
				} elseif ( $node->getOffset() < 0 || $node->getOffset() > 3 ) {
					$available       = false;
					$entry['status'] = 'unavailable';
					$entry['code']   = 'preview-code-projection-source-unavailable';
				} else {
					$entry['info']        = $info;
					$entry['fenceOffset'] = (int) $node->getOffset();
				}
			}

			if ( $available ) {
				$rows = self::project_code_rows(
					$node,
					$metadata['rows'],
					$normalized_lines,
					$original_lines,
					$line_map,
					$row_count
				);
				if ( self::MAX_CODE_PROJECTION_ROWS < $row_count ) {
					return self::unavailable_code_projection( 'preview-code-projection-limit' );
				}
				if ( null === $rows ) {
					$available = false;
					$entry     = array(
						'kind'      => $kind,
						'startLine' => $entry_start,
						'endLine'   => $entry_end,
						'status'    => 'unavailable',
						'code'      => 'preview-code-projection-source-unavailable',
					);
				} else {
					$entry['rows'] = $rows;
				}
			}

			if ( ! $available ) {
				if ( ! isset( $entry['code'] ) ) {
					$entry = array(
						'kind'      => $kind,
						'startLine' => $entry_start,
						'endLine'   => $entry_end,
						'status'    => 'unavailable',
						'code'      => 'preview-code-projection-source-unavailable',
					);
				}
			}

			$entries[] = $entry;
		}

		$projection = array(
			'version'    => 1,
			'coordinate' => 'line',
			'offsetUnit' => 'utf16',
			'status'     => 'available',
			'entries'    => $entries,
		);
		$encoded    = self::encode_code_projection( $projection );
		if ( false === $encoded ) {
			return self::unavailable_code_projection( 'preview-code-projection-unavailable' );
		}
		if ( strlen( $encoded ) > self::MAX_CODE_PROJECTION_BYTES ) {
			return self::unavailable_code_projection( 'preview-code-projection-limit' );
		}

		return $projection;
	}

	/**
	 * @param array<int,array<string,mixed>> $metadata_rows
	 * @param array<int,array{content:string,ending:string}> $normalized_lines
	 * @param array<int,array{content:string,ending:string}> $original_lines
	 * @param array<int,array{start:int,end:int}> $line_map
	 * @return array<int,array<string,int>>|null
	 */
	private static function project_code_rows( AbstractBlock $node, array $metadata_rows, array $normalized_lines, array $original_lines, array $line_map, &$row_count ) {
		$literal_rows     = self::code_literal_rows( (string) $node->getLiteral() );
		$metadata_by_line = array();
		foreach ( $metadata_rows as $metadata_row ) {
			if ( ! is_array( $metadata_row ) || ! isset( $metadata_row['contentLine'] ) ) {
				return null;
			}
			$content_line = (int) $metadata_row['contentLine'];
			if ( $content_line < 0 || isset( $metadata_by_line[ $content_line ] ) ) {
				return null;
			}
			$metadata_by_line[ $content_line ] = $metadata_row;
		}

		$start_line = $node->getStartLine();
		$end_line   = $node->getEndLine();
		if ( null === $start_line || null === $end_line ) {
			return null;
		}
		$body_start_line = (int) $start_line + ( $node instanceof FencedCode ? 1 : 0 );
		$rows            = array();
		$previous_source = null;

		foreach ( $literal_rows as $content_line => $literal_row ) {
			$normalized_line_number = $body_start_line + $content_line;
			if ( $normalized_line_number > (int) $end_line || ! isset( $line_map[ $normalized_line_number ]['start'], $line_map[ $normalized_line_number ]['end'] ) ) {
				return null;
			}
			if ( $line_map[ $normalized_line_number ]['start'] !== $line_map[ $normalized_line_number ]['end'] ) {
				return null;
			}

			$source_line  = (int) $line_map[ $normalized_line_number ]['start'];
			$source_index = $source_line - 1;
			if ( $source_line < 1 || ! isset( $normalized_lines[ $normalized_line_number - 1 ], $original_lines[ $source_index ] ) ) {
				return null;
			}
			if ( $normalized_lines[ $normalized_line_number - 1 ]['content'] !== $original_lines[ $source_index ]['content'] ) {
				return null;
			}
			if ( null !== $previous_source && $source_line !== $previous_source + 1 ) {
				return null;
			}
			$previous_source = $source_line;

			if ( preg_match( '/^[ \t]*$/D', $literal_row ) ) {
				if ( isset( $metadata_by_line[ $content_line ] ) ) {
					return null;
				}
				continue;
			}

			if ( ! isset( $metadata_by_line[ $content_line ] ) ) {
				return null;
			}
			++$row_count;
			$metadata = $metadata_by_line[ $content_line ];
			if ( isset( $metadata['unavailable'] ) || ! isset( $metadata['line'], $metadata['before'], $metadata['after'] ) ) {
				return null;
			}
			if ( (int) $metadata['line'] !== $normalized_line_number ) {
				return null;
			}

			$normalized_row   = $normalized_lines[ $normalized_line_number - 1 ]['content'];
			$original_row     = $original_lines[ $source_index ]['content'];
			$before           = $metadata['before'];
			$after            = $metadata['after'];
			$before_position  = (int) $before['position'];
			$literal_position = (int) $after['position'] + ( self::partial_tab_width( $after, $normalized_row ) > 0 ? 1 : 0 );
			if ( $before_position < 0 || $literal_position < $before_position || $literal_position > self::character_length( $original_row ) ) {
				return null;
			}
			$consumed = self::character_substring( $original_row, $before_position, $literal_position - $before_position );
			if ( 1 !== preg_match( '/^[ \t]*$/D', $consumed ) ) {
				return null;
			}

			$leading_spaces    = self::partial_tab_width( $after, $normalized_row );
			$projected_literal = str_repeat( ' ', $leading_spaces ) . self::character_substring( $original_row, $literal_position );
			if ( $normalized_row !== $original_row || $projected_literal !== $literal_row ) {
				return null;
			}
			$prefix_tab_columns = self::partial_tab_columns( $before, $normalized_row );
			if ( null === $prefix_tab_columns ) {
				return null;
			}

			$rows[] = array(
				'sourceLine'           => $source_line - 1,
				'contentLine'          => (int) $content_line,
				'prefixEnd'            => self::utf16_offset( $original_row, $before_position ),
				'prefixTabColumns'     => $prefix_tab_columns,
				'literalFrom'          => self::utf16_offset( $original_row, $literal_position ),
				'literalLeadingSpaces' => $leading_spaces,
			);
		}

		foreach ( $metadata_by_line as $content_line => $metadata ) {
			if ( $content_line >= count( $literal_rows ) || preg_match( '/^[ \t]*$/D', $literal_rows[ $content_line ] ) ) {
				return null;
			}
		}

		return $rows;
	}

	private static function partial_tab_width( array $snapshot, $line ) {
		$position = (int) $snapshot['position'];
		$column   = (int) $snapshot['column'];
		if ( "\t" !== self::character_at( $line, $position ) || 0 === $column % 4 ) {
			return 0;
		}

		$width           = 4 - ( $column % 4 );
		$suffix          = self::character_substring( $line, $position + 1 );
		$expected_length = $width + self::character_length( $suffix );
		if ( $expected_length !== (int) $snapshot['remainderLength'] || (int) $snapshot['remainderLeadingSpaces'] < $width ) {
			return 0;
		}

		return $width;
	}

	private static function partial_tab_columns( array $snapshot, $line ) {
		if ( self::partial_tab_width( $snapshot, $line ) < 1 ) {
			return 0;
		}

		$raw_prefix_columns = self::raw_prefix_columns( $line, (int) $snapshot['position'] );
		$consumed_columns   = (int) $snapshot['column'] - $raw_prefix_columns;

		return $consumed_columns >= 1 && $consumed_columns <= 3 ? $consumed_columns : null;
	}

	private static function raw_prefix_columns( $line, $position ) {
		$prefix  = self::character_substring( $line, 0, $position );
		$columns = 0;
		$length  = self::character_length( $prefix );
		for ( $index = 0; $index < $length; ++$index ) {
			if ( "\t" === self::character_at( $prefix, $index ) ) {
				$columns += 4 - ( $columns % 4 );
			} else {
				++$columns;
			}
		}

		return $columns;
	}

	private static function character_length( $value ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( (string) $value, 'UTF-8' ) : strlen( (string) $value );
	}

	private static function character_at( $value, $position ) {
		return function_exists( 'mb_substr' ) ? mb_substr( (string) $value, (int) $position, 1, 'UTF-8' ) : substr( (string) $value, (int) $position, 1 );
	}

	private static function character_substring( $value, $start, $length = null ) {
		if ( function_exists( 'mb_substr' ) ) {
			return mb_substr( (string) $value, (int) $start, null === $length ? null : (int) $length, 'UTF-8' );
		}

		return null === $length ? substr( (string) $value, (int) $start ) : substr( (string) $value, (int) $start, (int) $length );
	}

	private static function utf16_offset( $value, $character_position ) {
		$prefix = self::character_substring( $value, 0, $character_position );
		if ( function_exists( 'mb_convert_encoding' ) ) {
			return (int) ( strlen( mb_convert_encoding( $prefix, 'UTF-16LE', 'UTF-8' ) ) / 2 );
		}

		return (int) $character_position;
	}

	private static function unavailable_code_projection( $code ) {
		return array(
			'version'    => 1,
			'coordinate' => 'line',
			'offsetUnit' => 'utf16',
			'status'     => 'unavailable',
			'code'       => (string) $code,
		);
	}

	private static function encode_code_projection( array $projection ) {
		return wp_json_encode( $projection, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS );
	}

	/**
	 * @param array<int,AbstractBlock> $nodes
	 */
	private static function collect_source_code_nodes( AbstractBlock $container, array &$nodes ) {
		foreach ( $container->children() as $child ) {
			if ( $child instanceof FencedCode || $child instanceof IndentedCode ) {
				$nodes[] = $child;
				continue;
			}
			if ( $child instanceof AbstractBlock ) {
				self::collect_source_code_nodes( $child, $nodes );
			}
		}
	}

	/**
	 * @return array<int,array{content:string,ending:string}>
	 */
	private static function split_source_lines( $source ) {
		$source = (string) $source;
		$lines  = array();
		$length = strlen( $source );
		$start  = 0;

		for ( $index = 0; $index < $length; ++$index ) {
			if ( "\r" !== $source[ $index ] && "\n" !== $source[ $index ] ) {
				continue;
			}

			$ending_length = 1;
			if ( "\r" === $source[ $index ] && $index + 1 < $length && "\n" === $source[ $index + 1 ] ) {
				$ending_length = 2;
			}
			$lines[] = array(
				'content' => substr( $source, $start, $index - $start ),
				'ending'  => substr( $source, $index, $ending_length ),
			);
			$index  += $ending_length - 1;
			$start   = $index + 1;
		}

		if ( $start < $length || empty( $lines ) ) {
			$lines[] = array(
				'content' => substr( $source, $start ),
				'ending'  => '',
			);
		}

		return $lines;
	}

	/**
	 * @return array<int,string>
	 */
	private static function code_literal_rows( $literal ) {
		$literal = (string) $literal;
		if ( '' === $literal ) {
			return array();
		}
		if ( "\n" === substr( $literal, -1 ) ) {
			$literal = substr( $literal, 0, -1 );
		}

		return explode( "\n", $literal );
	}

	private static function unavailable_code_map( $code ) {
		return array(
			'version'    => 1,
			'coordinate' => 'line',
			'status'     => 'unavailable',
			'code'       => (string) $code,
		);
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
