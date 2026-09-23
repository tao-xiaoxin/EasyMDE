<?php

namespace EasyMDE\Content;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\CommonMark\Node\Block\FencedCode;
use League\CommonMark\Extension\CommonMark\Node\Block\IndentedCode;
use League\CommonMark\Extension\GithubFlavoredMarkdownExtension;
use League\CommonMark\Parser\MarkdownParser;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Finds Markdown code regions before math detection or extraction runs.
 *
 * CommonMark owns block classification. A small delimiter scanner is used for
 * inline code because CommonMark inline nodes do not expose source offsets.
 */
final class MarkdownCodeRegionScanner {

	/**
	 * @return array<int, array{start:int, end:int}>
	 */
	public static function ranges( $markdown ) {
		$markdown = (string) $markdown;
		if ( '' === $markdown ) {
			return array();
		}

		$ranges = self::block_ranges( $markdown );
		$ranges = array_merge( $ranges, self::inline_code_ranges( $markdown, $ranges ) );

		usort(
			$ranges,
			static function ( $left, $right ) {
				return $left['start'] <=> $right['start'];
			}
		);

		$merged = array();
		foreach ( $ranges as $range ) {
			if ( $range['end'] <= $range['start'] ) {
				continue;
			}
			$last_index = count( $merged ) - 1;
			if ( $last_index >= 0 && $range['start'] <= $merged[ $last_index ]['end'] ) {
				$merged[ $last_index ]['end'] = max( $merged[ $last_index ]['end'], $range['end'] );
				continue;
			}
			$merged[] = $range;
		}

		return $merged;
	}

	public static function contains_math_outside_code( $markdown ) {
		$markdown = (string) $markdown;
		if ( false === strpos( $markdown, '$' )
			&& false === strpos( $markdown, '\\[' )
			&& false === strpos( $markdown, '\\(' ) ) {
			return false;
		}

		foreach ( self::outside_code_segments( $markdown ) as $segment ) {
			if ( (bool) preg_match( '/(\$\$[\s\S]+?\$\$|\\\\\[|\\\\\(|(?<!\\\\)\$[^\n$]+?(?<!\\\\)\$)/', $segment ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * @param callable(string):string $processor
	 */
	public static function process_outside_code( $markdown, callable $processor ) {
		$markdown = (string) $markdown;
		$ranges   = self::ranges( $markdown );
		if ( empty( $ranges ) ) {
			return $processor( $markdown );
		}

		$output = '';
		$cursor = 0;
		foreach ( $ranges as $range ) {
			if ( $range['start'] > $cursor ) {
				$output .= $processor( substr( $markdown, $cursor, $range['start'] - $cursor ) );
			}
			$output .= substr( $markdown, $range['start'], $range['end'] - $range['start'] );
			$cursor  = $range['end'];
		}
		if ( $cursor < strlen( $markdown ) ) {
			$output .= $processor( substr( $markdown, $cursor ) );
		}

		return $output;
	}

	/**
	 * @return array<int, array{start:int, end:int}>
	 */
	private static function block_ranges( $markdown ) {
		if ( false === strpos( $markdown, '`' )
			&& false === strpos( $markdown, '~' )
			&& ! preg_match( '/(^|\r\n|\n|\r)(?: {4}|\t)/', $markdown ) ) {
			return array();
		}
		if ( ! class_exists( Environment::class ) || ! class_exists( MarkdownParser::class ) ) {
			return self::fallback_block_ranges( $markdown );
		}

		$environment = new Environment(
			array(
				'html_input'              => 'strip',
				'allow_unsafe_links'      => false,
				'max_nesting_level'       => MarkdownRenderer::MAX_NESTING_LEVEL,
				'max_delimiters_per_line' => MarkdownRenderer::MAX_DELIMITERS_PER_LINE,
			)
		);
		$environment->addExtension( new CommonMarkCoreExtension() );
		$environment->addExtension( new GithubFlavoredMarkdownExtension() );
		$document    = ( new MarkdownParser( $environment ) )->parse( $markdown );
		$line_starts = self::line_starts( $markdown );
		$ranges      = array();

		foreach ( $document->iterator() as $node ) {
			if ( ! $node instanceof FencedCode && ! $node instanceof IndentedCode ) {
				continue;
			}
			$start_line = $node->getStartLine();
			$end_line   = $node->getEndLine();
			if ( null === $start_line || null === $end_line ) {
				continue;
			}
			$start = $line_starts[ $start_line - 1 ] ?? null;
			$end   = $line_starts[ $end_line ] ?? strlen( $markdown );
			if ( null !== $start ) {
				$ranges[] = array(
					'end'   => $end,
					'start' => $start,
				);
			}
		}

		return $ranges;
	}

	/**
	 * @param array<int, array{start:int, end:int}> $protected_ranges
	 * @return array<int, array{start:int, end:int}>
	 */
	private static function inline_code_ranges( $markdown, array $protected_ranges ) {
		$ranges = array();
		$length = strlen( $markdown );
		$index  = 0;

		while ( $index < $length ) {
			$protected_end = self::protected_end_at( $index, $protected_ranges );
			if ( null !== $protected_end ) {
				$index = $protected_end;
				continue;
			}
			if ( '`' !== $markdown[ $index ] || self::is_escaped( $markdown, $index ) ) {
				++$index;
				continue;
			}

			$run_end = $index;
			while ( $run_end < $length && '`' === $markdown[ $run_end ] ) {
				++$run_end;
			}
			$run_length = $run_end - $index;
			$close      = self::find_closing_backticks( $markdown, $run_end, $run_length, $protected_ranges );
			if ( null === $close ) {
				$index = $run_end;
				continue;
			}

			$ranges[] = array(
				'end'   => $close + $run_length,
				'start' => $index,
			);
			$index    = $close + $run_length;
		}

		return $ranges;
	}

	private static function find_closing_backticks( $markdown, $start, $run_length, array $protected_ranges ) {
		$length = strlen( $markdown );
		$index  = $start;
		while ( $index < $length ) {
			$protected_end = self::protected_end_at( $index, $protected_ranges );
			if ( null !== $protected_end ) {
				return null;
			}
			if ( '`' !== $markdown[ $index ] ) {
				++$index;
				continue;
			}
			$run_end = $index;
			while ( $run_end < $length && '`' === $markdown[ $run_end ] ) {
				++$run_end;
			}
			if ( $run_end - $index === $run_length ) {
				return $index;
			}
			$index = $run_end;
		}

		return null;
	}

	private static function protected_end_at( $index, array $ranges ) {
		foreach ( $ranges as $range ) {
			if ( $index < $range['start'] ) {
				return null;
			}
			if ( $index < $range['end'] ) {
				return $range['end'];
			}
		}

		return null;
	}

	private static function is_escaped( $markdown, $index ) {
		$slashes = 0;
		for ( $cursor = $index - 1; $cursor >= 0 && '\\' === $markdown[ $cursor ]; $cursor-- ) {
			++$slashes;
		}

		return 1 === $slashes % 2;
	}

	/**
	 * @return array<int, string>
	 */
	private static function outside_code_segments( $markdown ) {
		$ranges   = self::ranges( $markdown );
		$segments = array();
		$cursor   = 0;
		foreach ( $ranges as $range ) {
			if ( $range['start'] > $cursor ) {
				$segments[] = substr( $markdown, $cursor, $range['start'] - $cursor );
			}
			$cursor = $range['end'];
		}
		if ( $cursor < strlen( $markdown ) ) {
			$segments[] = substr( $markdown, $cursor );
		}

		return $segments;
	}

	/**
	 * @return array<int, int>
	 */
	private static function line_starts( $markdown ) {
		$starts = array( 0 );
		if ( preg_match_all( '/\r\n|\n|\r/', $markdown, $matches, PREG_OFFSET_CAPTURE ) ) {
			foreach ( $matches[0] as $match ) {
				$starts[] = $match[1] + strlen( $match[0] );
			}
		}

		return $starts;
	}

	/**
	 * @return array<int, array{start:int, end:int}>
	 */
	private static function fallback_block_ranges( $markdown ) {
		$ranges       = array();
		$line_starts  = self::line_starts( $markdown );
		$lines        = preg_split( '/\r\n|\n|\r/', $markdown );
		$line_count   = is_array( $lines ) ? count( $lines ) : 0;
		$in_fence     = false;
		$fence_char   = '';
		$fence_length = 0;
		$range_start  = null;

		for ( $index = 0; $index < $line_count; ++$index ) {
			$line = $lines[ $index ];
			if ( $in_fence ) {
				if ( preg_match( '/^ {0,3}(`{3,}|~{3,})[ \t]*$/', $line, $match )
					&& substr( $match[1], 0, 1 ) === $fence_char
					&& strlen( $match[1] ) >= $fence_length ) {
					$in_fence    = false;
					$ranges[]    = array(
						'end'   => $line_starts[ $index + 1 ] ?? strlen( $markdown ),
						'start' => $range_start,
					);
					$range_start = null;
				}
				continue;
			}

			if ( preg_match( '/^ {0,3}(`{3,}|~{3,})[^\r\n]*$/', $line, $match ) ) {
				$in_fence     = true;
				$fence_char   = substr( $match[1], 0, 1 );
				$fence_length = strlen( $match[1] );
				$range_start  = $line_starts[ $index ] ?? 0;
				continue;
			}

			if ( preg_match( '/^(?: {4}|\t)/', $line ) ) {
				$start = $index;
				while ( $start + 1 < $line_count && preg_match( '/^(?: {4}|\t)/', $lines[ $start + 1 ] ) ) {
					++$start;
				}
				$ranges[] = array(
					'end'   => $line_starts[ $start + 1 ] ?? strlen( $markdown ),
					'start' => $line_starts[ $index ] ?? 0,
				);
				$index    = $start;
			}
		}

		if ( $in_fence && null !== $range_start ) {
			$ranges[] = array(
				'end'   => strlen( $markdown ),
				'start' => $range_start,
			);
		}

		return $ranges;
	}
}
