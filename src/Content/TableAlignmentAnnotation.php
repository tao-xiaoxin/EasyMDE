<?php

namespace EasyMDE\Content;

use League\CommonMark\Environment\EnvironmentInterface;
use League\CommonMark\Event\DocumentParsedEvent;
use League\CommonMark\Extension\CommonMark\Node\Block\HtmlBlock;
use League\CommonMark\Extension\Table\Table;
use League\CommonMark\Extension\Table\TableCell;
use League\CommonMark\Extension\Table\TableRow;
use League\CommonMark\Extension\Table\TableSection;
use League\CommonMark\Node\Block\AbstractBlock;
use RuntimeException;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Applies the validated row/cell alignment marker to CommonMark table cells.
 *
 * The marker is consumed from the AST before HTML rendering. Markdown remains
 * the source of truth, while the table node keeps only the request-local line
 * needed by the visual Preview edit map.
 */
final class TableAlignmentAnnotation {

	const SOURCE_PREFIX_START_LINE = 'easymde/table-alignment-prefix-start-line';
	const MAX_MARKER_LENGTH        = 4096;
	const MAX_ENTRIES              = 1000;
	const MARKER_PREFIX            = '<!-- easymde-table-align:v1 ';
	const MARKER_RESERVED_PREFIX   = '<!-- easymde-table-align:';
	const MARKER_SUFFIX            = ' -->';

	const ERROR_MARKER_INVALID   = 'table-alignment-annotation-marker-invalid';
	const ERROR_MARKER_ORPHAN    = 'table-alignment-annotation-marker-orphan';
	const ERROR_MARKER_TOO_LARGE = 'table-alignment-annotation-marker-too-large';
	const ERROR_ENTRY_INVALID    = 'table-alignment-annotation-entry-invalid';
	const ERROR_ENTRY_ORDER      = 'table-alignment-annotation-entry-order-invalid';
	const ERROR_ENTRY_REDUNDANT  = 'table-alignment-annotation-entry-redundant';

	public static function register( EnvironmentInterface $environment ) {
		$environment->addEventListener( DocumentParsedEvent::class, array( new self(), 'on_document_parsed' ) );
	}

	/**
	 * @return void
	 */
	public function on_document_parsed( DocumentParsedEvent $event ) {
		self::process_container( $event->getDocument() );
	}

	/**
	 * @return int|null
	 */
	public static function source_prefix_start_line( Table $table ) {
		$value = $table->data->get( self::SOURCE_PREFIX_START_LINE, null );
		return is_int( $value ) && $value > 0 ? $value : null;
	}

	/**
	 * @param AbstractBlock $container
	 * @return void
	 */
	private static function process_container( AbstractBlock $container ) {
		foreach ( $container->children() as $child ) {
			if ( $child instanceof HtmlBlock && self::is_reserved_marker( $child->getLiteral() ) ) {
				self::apply_marker( $child );
				continue;
			}

			if ( $child instanceof AbstractBlock && ! $child instanceof Table ) {
				self::process_container( $child );
			}
		}
	}

	private static function is_reserved_marker( $literal ) {
		$literal = (string) $literal;
		return (bool) preg_match( '/^ {0,3}<!-- easymde-table-align:/D', $literal );
	}

	/**
	 * @param HtmlBlock $marker
	 * @return void
	 */
	private static function apply_marker( HtmlBlock $marker ) {
		$entries = self::parse_marker( $marker->getLiteral() );
		$table   = $marker->next();
		if ( ! $table instanceof Table || $table->parent() !== $marker->parent() ) {
			self::fail( self::ERROR_MARKER_ORPHAN );
		}

		$marker_end  = $marker->getEndLine();
		$table_start = $table->getStartLine();
		if ( null === $marker_end || null === $table_start || $table_start !== $marker_end + 1 ) {
			self::fail( self::ERROR_MARKER_ORPHAN );
		}

		$rows = self::table_rows( $table );
		if ( empty( $rows ) ) {
			self::fail( self::ERROR_ENTRY_INVALID );
		}

		$column_count = self::table_column_count( $rows );
		if ( $column_count < 1 ) {
			self::fail( self::ERROR_ENTRY_INVALID );
		}
		$base_alignments = self::base_alignments( $rows[0], $column_count );
		$entries         = self::validate_entries( $entries, count( $rows ), $column_count, $base_alignments );

		foreach ( $entries as $entry ) {
			if ( 2 === count( $entry ) ) {
				foreach ( $rows[ $entry[0] ] as $cell ) {
					$cell->setAlign( $entry[1] );
				}
			}
		}
		foreach ( $entries as $entry ) {
			if ( 3 === count( $entry ) ) {
				$cells = $rows[ $entry[0] ];
				$cells[ $entry[1] ]->setAlign( $entry[2] );
			}
		}

		$prefix_start = $marker->getStartLine();
		if ( null === $prefix_start || $prefix_start < 1 ) {
			self::fail( self::ERROR_MARKER_ORPHAN );
		}
		$table->data->set( self::SOURCE_PREFIX_START_LINE, (int) $prefix_start );
		$marker->detach();
	}

	/**
	 * @return array<int,array<int,TableCell>>
	 */
	private static function table_rows( Table $table ) {
		$rows = array();
		foreach ( $table->children() as $section ) {
			if ( ! $section instanceof TableSection ) {
				continue;
			}
			foreach ( $section->children() as $row ) {
				if ( ! $row instanceof TableRow ) {
					continue;
				}
				$rows[] = self::row_cells( $row );
			}
		}

		return $rows;
	}

	/**
	 * @return array<int,TableCell>
	 */
	private static function row_cells( TableRow $row ) {
		$cells = array();
		foreach ( $row->children() as $cell ) {
			if ( $cell instanceof TableCell ) {
				$cells[] = $cell;
			}
		}

		return $cells;
	}

	/**
	 * @param array<int,array<int,TableCell>> $rows
	 */
	private static function table_column_count( array $rows ) {
		$count = 0;
		foreach ( $rows as $row ) {
			$count = max( $count, count( $row ) );
		}

		return $count;
	}

	/**
	 * @param array<int,TableCell> $row
	 * @return array<int,string|null>
	 */
	private static function base_alignments( array $row, $column_count ) {
		$alignments = array();
		for ( $column = 0; $column < $column_count; ++$column ) {
			$alignments[] = isset( $row[ $column ] ) ? $row[ $column ]->getAlign() : null;
		}

		return $alignments;
	}

	/**
	 * @return array<int,array<int,mixed>>
	 */
	private static function parse_marker( $literal ) {
		$literal = (string) $literal;
		if ( false !== strpos( $literal, "\r" ) || false !== strpos( $literal, "\n" ) ) {
			self::fail( self::ERROR_MARKER_INVALID );
		}
		if ( false !== strpos( $literal, "\t" ) ) {
			self::fail( self::ERROR_MARKER_INVALID );
		}
		$trimmed = trim( $literal, ' ' );
		if ( strlen( $trimmed ) > self::MAX_MARKER_LENGTH ) {
			self::fail( self::ERROR_MARKER_TOO_LARGE );
		}
		if ( 0 !== strpos( $trimmed, self::MARKER_PREFIX ) || self::MARKER_SUFFIX !== substr( $trimmed, -strlen( self::MARKER_SUFFIX ) ) ) {
			self::fail( self::ERROR_MARKER_INVALID );
		}

		$payload = substr( $trimmed, strlen( self::MARKER_PREFIX ), -strlen( self::MARKER_SUFFIX ) );
		try {
			$decoded = json_decode( $payload, false, 512, JSON_THROW_ON_ERROR );
		} catch ( \JsonException $exception ) {
			self::fail( self::ERROR_MARKER_INVALID );
		}

		if ( ! is_array( $decoded ) || ! self::is_list( $decoded ) || count( $decoded ) > self::MAX_ENTRIES ) {
			self::fail( self::ERROR_ENTRY_INVALID );
		}

		return $decoded;
	}

	/**
	 * @param array<int,array<int,mixed>> $entries
	 * @param array<int,string|null>      $base_alignments
	 * @return array<int,array<int,mixed>>
	 */
	private static function validate_entries( array $entries, $row_count, $column_count, array $base_alignments ) {
		$previous           = null;
		$normalized_entries = array();
		foreach ( $entries as $entry ) {
			if ( ! is_array( $entry ) || ! self::is_list( $entry ) || ( 2 !== count( $entry ) && 3 !== count( $entry ) ) ) {
				self::fail( self::ERROR_ENTRY_INVALID );
			}

			$row    = self::safe_integer( $entry[0] );
			$column = 3 === count( $entry ) ? self::safe_integer( $entry[1] ) : null;
			$align  = $entry[ count( $entry ) - 1 ];
			if ( null === $row || ( 3 === count( $entry ) && null === $column ) || ! self::is_alignment( $align ) || $row >= $row_count || ( null !== $column && $column >= $column_count ) ) {
				self::fail( self::ERROR_ENTRY_INVALID );
			}

			$normalized_entry = 2 === count( $entry )
				? array( $row, $align )
				: array( $row, $column, $align );
			$current_order    = array( $row, -1 );
			if ( 3 === count( $normalized_entry ) ) {
				$current_order[1] = $column;
			}
			if ( null !== $previous && ( $current_order[0] < $previous[0] || ( $current_order[0] === $previous[0] && $current_order[1] <= $previous[1] ) ) ) {
				self::fail( self::ERROR_ENTRY_ORDER );
			}
			$previous             = $current_order;
			$normalized_entries[] = $normalized_entry;
		}

		foreach ( $normalized_entries as $entry ) {
			$row   = $entry[0];
			$align = $entry[ count( $entry ) - 1 ];
			if ( 2 === count( $entry ) ) {
				$has_different_base = false;
				foreach ( $base_alignments as $base ) {
					if ( $base !== $align ) {
						$has_different_base = true;
						break;
					}
				}
				$has_cell_exception = false;
				foreach ( $normalized_entries as $candidate ) {
					if ( 3 === count( $candidate ) && $candidate[0] === $row ) {
						$has_cell_exception = true;
						break;
					}
				}
				if ( ! $has_different_base && ! $has_cell_exception ) {
					self::fail( self::ERROR_ENTRY_REDUNDANT );
				}
				continue;
			}

			$row_alignment = null;
			foreach ( $normalized_entries as $candidate ) {
				if ( 2 === count( $candidate ) && $candidate[0] === $row ) {
					$row_alignment = $candidate[1];
					break;
				}
			}
			if ( null === $row_alignment || $row_alignment === $align ) {
				self::fail( self::ERROR_ENTRY_REDUNDANT );
			}
		}

		return $normalized_entries;
	}

	private static function is_alignment( $value ) {
		return in_array( $value, array( TableCell::ALIGN_LEFT, TableCell::ALIGN_CENTER, TableCell::ALIGN_RIGHT ), true );
	}

	private static function safe_integer( $value ) {
		if ( is_int( $value ) && $value >= 0 && $value <= 9007199254740991 ) {
			return $value;
		}
		if ( is_float( $value ) && is_finite( $value ) && floor( $value ) === $value && $value >= 0 && $value <= 9007199254740991 ) {
			return (int) $value;
		}
		return null;
	}

	private static function is_list( array $value ) {
		$index = 0;
		foreach ( array_keys( $value ) as $key ) {
			if ( $key !== $index ) {
				return false;
			}
			++$index;
		}

		return true;
	}

	private static function fail( $code ) {
		// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- $code is a stable internal error identifier, not user-controlled output.
		throw new RuntimeException( $code );
	}
}
