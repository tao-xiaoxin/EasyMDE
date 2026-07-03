<?php

namespace EasyMDE\Content;

use League\CommonMark\GithubFlavoredMarkdownConverter;
use RuntimeException;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MarkdownRenderer {

	const MAX_NESTING_LEVEL       = 100;
	const MAX_DELIMITERS_PER_LINE = 1000;

	public static function is_available() {
		return class_exists( GithubFlavoredMarkdownConverter::class );
	}

	public static function render( $markdown, $theme = '' ) {
		if ( ! self::is_available() ) {
			throw new RuntimeException( 'The league/commonmark dependency is required to render EasyMDE Markdown.' );
		}

		$markdown = (string) $markdown;
		$theme    = sanitize_key( (string) $theme );
		$math     = array();
		$markdown = self::extract_math( $markdown, $math );
		$markdown = ThemeMarkupTransformer::normalize_markdown( $markdown, $theme );

		$converter = new GithubFlavoredMarkdownConverter(
			array(
				'html_input'              => 'strip',
				'allow_unsafe_links'      => false,
				'max_nesting_level'       => self::MAX_NESTING_LEVEL,
				'max_delimiters_per_line' => self::MAX_DELIMITERS_PER_LINE,
			)
		);

		$html = self::restore_math( wp_kses_post( (string) $converter->convert( $markdown ) ), $math );

		return self::post_process_html( $html, $theme );
	}

	private static function extract_math( $markdown, array &$math ) {
		$patterns = array(
			'/\$\$([\s\S]+?)\$\$/',
			'/\\\\\[([\s\S]+?)\\\\\]/',
			'/\\\\\(([\s\S]+?)\\\\\)/',
			'/(?<!\\\\)\$([^\n$]+?)(?<!\\\\)\$/',
		);

		foreach ( $patterns as $pattern ) {
			$markdown = preg_replace_callback(
				$pattern,
				function ( $matches ) use ( &$math, $pattern ) {
					$token          = 'EASYMDE_MATH_' . count( $math ) . '_TOKEN';
					$is_block       = 0 === strpos( $pattern, '/\$\$' ) || 0 === strpos( $pattern, '/\\\\\[' );
					$math[ $token ] = array(
						'tex'   => $matches[1],
						'block' => $is_block,
					);

					return $is_block ? "\n\n" . $token . "\n\n" : $token;
				},
				$markdown
			);
		}

		return $markdown;
	}

	private static function restore_math( $html, array $math ) {
		foreach ( $math as $token => $item ) {
			$tex     = self::normalize_math_tex( trim( (string) $item['tex'] ) );
			$escaped = esc_html( $tex );
			$node    = $item['block']
				? '<div class="easymde-math easymde-math-block">$$' . $escaped . '$$</div>'
				: '<span class="easymde-math easymde-math-inline">\\(' . $escaped . '\\)</span>';

			if ( $item['block'] ) {
				$html = preg_replace( '/<p>\s*' . preg_quote( $token, '/' ) . '\s*<\/p>/', $node, $html );
			}

			$html = str_replace( $token, $node, $html );
		}

		return $html;
	}

	private static function normalize_math_tex( $tex ) {
		$tex = (string) $tex;

		if ( '' === $tex ) {
			return $tex;
		}

		$command_patterns = array(
			'/(?<![A-Za-z\\\\])(begin|end)(?=\s*\{)/',
			'/(?<![A-Za-z\\\\])(frac|dfrac|tfrac|binom|sqrt)(?=\s*\{)/',
			'/(?<![A-Za-z\\\\])(left|right)(?=\s*(?:[()\[\]{}|.]|\\\\[{}]))/',
			'/(?<![A-Za-z\\\\])(log|ln|exp|lim|sin|cos|tan|cot|sec|csc|min|max|sup|inf)(?![A-Za-z])/',
			'/(?<![A-Za-z\\\\])(cdots|ldots|dots|vdots|ddots|cdot|times|div|pm|mp|leq|geq|neq|approx|infty)(?![A-Za-z])/',
		);

		foreach ( $command_patterns as $pattern ) {
			$tex = preg_replace( $pattern, '\\\\$1', $tex );
		}

		return self::normalize_matrix_row_separators( $tex );
	}

	private static function normalize_matrix_row_separators( $tex ) {
		return preg_replace_callback(
			'/\\\\begin\{([A-Za-z]*matrix|array)\}([\s\S]*?)\\\\end\{\1\}/',
			function ( $matches ) {
				$body = preg_replace( '/(?<!\\\\)\\\\(?![\\\\A-Za-z{])/', '\\\\\\\\\\\\\\\\', $matches[2] );

				return '\\begin{' . $matches[1] . '}' . $body . '\\end{' . $matches[1] . '}';
			},
			$tex
		);
	}

	private static function post_process_html( $html, $theme = '' ) {
		$html = TocGenerator::add_heading_ids_and_toc( $html );
		$html = ThemeMarkupTransformer::transform( $html, $theme );

		return wp_kses_post( $html );
	}
}
