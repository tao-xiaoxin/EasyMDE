<?php

namespace EasyMDE\Content;

use League\CommonMark\GithubFlavoredMarkdownConverter;
use League\CommonMark\Parser\MarkdownParser;
use League\CommonMark\Renderer\HtmlRenderer;
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

		$converter = self::create_converter();

		$html = self::restore_math( self::sanitize_rendered_html( (string) $converter->convert( $markdown ), $theme, true, false ), $math );

		return self::post_process_html( $html, $theme );
	}

	/**
	 * Render the formal Preview HTML and its request-local visual edit map.
	 *
	 * The HTML still comes from the same CommonMark environment and the same
	 * post-processing/sanitization pipeline as render(). The source markers are
	 * temporary and are removed before the response is returned.
	 *
	 * @return array{html:string,editMap:array{version:int,coordinate:string,blocks:array<int,array{id:string,startLine:int,endLine:int,editable:bool}>}}
	 */
	public static function render_preview( $markdown, $theme = '' ) {
		if ( ! self::is_available() ) {
			throw new RuntimeException( 'The league/commonmark dependency is required to render EasyMDE Markdown.' );
		}

		$markdown = (string) $markdown;
		$theme    = sanitize_key( (string) $theme );

		$math               = array();
		$extracted_with_map = self::extract_math_with_line_map( $markdown, $math );
		$extracted_markdown = $extracted_with_map['markdown'];

		$normalized = ThemeMarkupTransformer::normalize_markdown_with_line_map(
			$extracted_markdown,
			$theme,
			$extracted_with_map['line_map']
		);

		$converter     = self::create_converter();
		$document      = ( new MarkdownParser( $converter->getEnvironment() ) )->parse( $normalized['markdown'] );
		$source_blocks = VisualPreviewBlockAnnotator::describe_source_blocks( $document, $normalized['line_map'] );
		VisualPreviewBlockAnnotator::mark_document( $document, $source_blocks );

		$html = (string) ( new HtmlRenderer( $converter->getEnvironment() ) )->renderDocument( $document );
		$html = self::restore_math(
			self::sanitize_rendered_html( $html, $theme, true, false, true ),
			$math,
			true
		);
		$html = self::post_process_html( $html, $theme, true );

		return VisualPreviewBlockAnnotator::finalize( $html, $source_blocks );
	}

	private static function create_converter() {
		return new GithubFlavoredMarkdownConverter(
			array(
				'html_input'              => 'strip',
				'allow_unsafe_links'      => false,
				'max_nesting_level'       => self::MAX_NESTING_LEVEL,
				'max_delimiters_per_line' => self::MAX_DELIMITERS_PER_LINE,
			)
		);
	}

	private static function extract_math( $markdown, array &$math ) {
		$patterns = array(
			'/\$\$([\s\S]+?)\$\$/',
			'/\\\\\[([\s\S]+?)\\\\\]/',
			'/\\\\\(([\s\S]+?)\\\\\)/',
			'/(?<!\\\\)\$([^\n$]+?)(?<!\\\\)\$/',
		);

		return MarkdownCodeRegionScanner::process_outside_code(
			$markdown,
			static function ( $segment ) use ( &$math, $patterns ) {
				foreach ( $patterns as $pattern ) {
					$segment = preg_replace_callback(
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
						$segment
					);
				}

				return $segment;
			}
		);
	}

	/**
	 * Replay extract_math() with source-line provenance for Preview mapping.
	 *
	 * @return array{markdown:string,line_map:array<int,array{start:int,end:int}>}
	 */
	private static function extract_math_with_line_map( $markdown, array &$math ) {
		$markdown    = (string) $markdown;
		$line_starts = self::source_line_starts( $markdown );
		$math        = array();
		$ranges      = MarkdownCodeRegionScanner::ranges( $markdown );
		$output      = '';
		$output_map  = array();
		$cursor      = 0;

		foreach ( $ranges as $range ) {
			if ( $range['start'] > $cursor ) {
				$outside = self::replace_math_segment_with_line_map(
					substr( $markdown, $cursor, $range['start'] - $cursor ),
					$cursor,
					$line_starts,
					$math
				);
				self::append_mapped_piece( $output, $output_map, $outside['markdown'], $outside['line_map'] );
			}

			$code = substr( $markdown, $range['start'], $range['end'] - $range['start'] );
			self::append_mapped_piece(
				$output,
				$output_map,
				$code,
				self::line_map_for_segment( $code, $range['start'], $line_starts )
			);
			$cursor = $range['end'];
		}

		if ( $cursor < strlen( $markdown ) ) {
			$outside = self::replace_math_segment_with_line_map( substr( $markdown, $cursor ), $cursor, $line_starts, $math );
			self::append_mapped_piece( $output, $output_map, $outside['markdown'], $outside['line_map'] );
		} elseif ( '' === $markdown ) {
			$output_map = array(
				array(
					'start' => 1,
					'end'   => 1,
				),
			);
		}

		return array(
			'markdown' => $output,
			'line_map' => array_combine( range( 1, count( $output_map ) ), array_values( $output_map ) ),
		);
	}

	/**
	 * @param array<int,int> $line_starts
	 * @return array{markdown:string,line_map:array<int,array{start:int,end:int}>}
	 */
	private static function replace_math_segment_with_line_map( $segment, $global_offset, array $line_starts, array &$math ) {
		$patterns         = array(
			'/\$\$([\s\S]+?)\$\$/',
			'/\\\\\[([\s\S]+?)\\\\\]/',
			'/\\\\\(([\s\S]+?)\\\\\)/',
			'/(?<!\\\\)\$([^\n$]+?)(?<!\\\\)\$/',
		);
		$current_markdown = (string) $segment;
		$current_map      = self::line_map_for_segment( $current_markdown, $global_offset, $line_starts );

		foreach ( $patterns as $pattern ) {
			$matches = array();
			$result  = preg_match_all( $pattern, $current_markdown, $matches, PREG_OFFSET_CAPTURE );
			if ( false === $result ) {
				throw new RuntimeException( 'Preview math extraction could not scan a Markdown segment.' );
			}
			if ( 0 === $result ) {
				continue;
			}

			$next_markdown = '';
			$next_map      = array();
			$cursor        = 0;
			foreach ( $matches[0] as $match_index => $full_match ) {
				$match_text   = (string) $full_match[0];
				$match_offset = (int) $full_match[1];
				self::append_mapped_piece(
					$next_markdown,
					$next_map,
					substr( $current_markdown, $cursor, $match_offset - $cursor ),
					self::slice_line_map( $current_markdown, $current_map, $cursor, $match_offset )
				);

				$origin         = self::range_for_line_map_slice(
					self::slice_line_map( $current_markdown, $current_map, $match_offset, $match_offset + strlen( $match_text ) )
				);
				$token          = 'EASYMDE_MATH_' . count( $math ) . '_TOKEN';
				$is_block       = 0 === strpos( $pattern, '/\$\$' ) || 0 === strpos( $pattern, '/\\\\\[' );
				$math[ $token ] = array(
					'tex'   => $matches[1][ $match_index ][0],
					'block' => $is_block,
				);

				$replacement = $is_block ? "\n\n" . $token . "\n\n" : $token;
				self::append_mapped_piece(
					$next_markdown,
					$next_map,
					$replacement,
					array_fill( 0, self::line_count( $replacement ), $origin )
				);
				$cursor = $match_offset + strlen( $match_text );
			}

			self::append_mapped_piece(
				$next_markdown,
				$next_map,
				substr( $current_markdown, $cursor ),
				self::slice_line_map( $current_markdown, $current_map, $cursor, strlen( $current_markdown ) )
			);
			$current_markdown = $next_markdown;
			$current_map      = $next_map;
		}

		return array(
			'markdown' => $current_markdown,
			'line_map' => array_values( $current_map ),
		);
	}

	/**
	 * @return array<int,int>
	 */
	private static function source_line_starts( $markdown ) {
		$starts = array( 0 );
		$length = strlen( (string) $markdown );
		for ( $index = 0; $index < $length; ++$index ) {
			if ( "\r" === $markdown[ $index ] ) {
				if ( $index + 1 < $length && "\n" === $markdown[ $index + 1 ] ) {
					++$index;
				}
				$starts[] = $index + 1;
			} elseif ( "\n" === $markdown[ $index ] ) {
				$starts[] = $index + 1;
			}
		}

		return $starts;
	}

	/**
	 * @param array<int,int> $line_starts
	 * @return array<int,array{start:int,end:int}>
	 */
	private static function line_map_for_segment( $segment, $global_offset, array $line_starts ) {
		$line_number = self::line_number_for_offset( (int) $global_offset, $line_starts );
		$map         = array();
		$line_count  = self::line_count( $segment );
		for ( $index = 0; $index < $line_count; ++$index ) {
			$map[] = array(
				'start' => $line_number + $index,
				'end'   => $line_number + $index,
			);
		}

		return $map;
	}

	/**
	 * @param array<int,int> $line_starts
	 */
	private static function line_number_for_offset( $offset, array $line_starts ) {
		$low  = 0;
		$high = count( $line_starts ) - 1;
		$best = 0;
		while ( $low <= $high ) {
			$middle = (int) floor( ( $low + $high ) / 2 );
			if ( $line_starts[ $middle ] <= $offset ) {
				$best = $middle;
				$low  = $middle + 1;
			} else {
				$high = $middle - 1;
			}
		}

		return $best + 1;
	}

	private static function line_count( $text ) {
		$count = 1;
		preg_match_all( '/\r\n|\r|\n/', (string) $text, $matches );

		return $count + count( $matches[0] );
	}

	/**
	 * @param array<int,array{start:int,end:int}> $line_map
	 * @return array<int,array{start:int,end:int}>
	 */
	private static function slice_line_map( $text, array $line_map, $start, $end ) {
		if ( $start >= $end || empty( $line_map ) ) {
			return array();
		}

		$text             = (string) $text;
		$start            = max( 0, min( strlen( $text ), (int) $start ) );
		$end              = max( $start, min( strlen( $text ), (int) $end ) );
		$start_line_index = 0;
		$delimiter_count  = 0;
		preg_match_all( '/\r\n|\r|\n/', $text, $matches, PREG_OFFSET_CAPTURE );

		foreach ( $matches[0] as $match ) {
			$delimiter_start = (int) $match[1];
			if ( $delimiter_start < $start ) {
				++$start_line_index;
				continue;
			}

			if ( $delimiter_start < $end ) {
				++$delimiter_count;
			}
		}

		$line_count = $delimiter_count + 1;
		if ( $start_line_index + $line_count > count( $line_map ) ) {
			throw new RuntimeException( 'Preview source provenance slice exceeded its line map.' );
		}

		return array_values( array_slice( $line_map, $start_line_index, $line_count ) );
	}

	/**
	 * @param array<int,array{start:int,end:int}> $line_map
	 * @return array{start:int,end:int}
	 */
	private static function range_for_line_map_slice( array $line_map ) {
		if ( empty( $line_map ) ) {
			throw new RuntimeException( 'Preview math extraction produced an empty source range.' );
		}

		$start = null;
		$end   = null;
		foreach ( $line_map as $line ) {
			$start = null === $start ? $line['start'] : min( $start, $line['start'] );
			$end   = null === $end ? $line['end'] : max( $end, $line['end'] );
		}

		return array(
			'start' => (int) $start,
			'end'   => (int) $end,
		);
	}

	/**
	 * @param array<int,array{start:int,end:int}> $piece_map
	 */
	private static function append_mapped_piece( &$output, array &$output_map, $piece, array $piece_map ) {
		$piece = (string) $piece;
		if ( '' === $piece ) {
			return;
		}
		if ( count( $piece_map ) !== self::line_count( $piece ) ) {
			throw new RuntimeException( 'easymde_preview_source_map_line_count_mismatch' );
		}

		if ( '' !== $output ) {
			if ( empty( $output_map ) || ! isset( $piece_map[0] ) ) {
				throw new RuntimeException( 'easymde_preview_source_map_join_failed' );
			}
			$output_map[ count( $output_map ) - 1 ] = self::merge_line_ranges(
				$output_map[ count( $output_map ) - 1 ],
				$piece_map[0]
			);
			$piece_map                              = array_slice( $piece_map, 1 );
		}

		$output .= $piece;
		foreach ( $piece_map as $line ) {
			$output_map[] = $line;
		}
	}

	/**
	 * @param array{start:int,end:int} $left
	 * @param array{start:int,end:int} $right
	 * @return array{start:int,end:int}
	 */
	private static function merge_line_ranges( array $left, array $right ) {
		return array(
			'start' => min( $left['start'], $right['start'] ),
			'end'   => max( $left['end'], $right['end'] ),
		);
	}

	private static function restore_math( $html, array $math, $preserve_visual_markers = false ) {
		foreach ( $math as $token => $item ) {
			$tex     = self::normalize_math_tex( trim( (string) $item['tex'] ) );
			$escaped = esc_html( $tex );
			$node    = $item['block']
				? '<div class="easymde-math easymde-math-block">$$' . $escaped . '$$</div>'
				: '<span class="easymde-math easymde-math-inline">\\(' . $escaped . '\\)</span>';

			if ( $item['block'] ) {
				if ( $preserve_visual_markers ) {
					$html = preg_replace_callback(
						'/<p([^>]*)>\s*' . preg_quote( $token, '/' ) . '\s*<\/p>/',
						static function ( $matches ) use ( $node ) {
							$source_attribute = '';
							if ( preg_match( '/\sdata-easymde-visual-source-id="([^"]+)"/', $matches[1], $attribute_matches ) ) {
								$source_attribute = ' data-easymde-visual-source-id="' . esc_attr( $attribute_matches[1] ) . '"';
							}

							return str_replace( '<div class="easymde-math easymde-math-block">', '<div class="easymde-math easymde-math-block"' . $source_attribute . '>', $node );
						},
						$html
					);
				} else {
					$html = preg_replace( '/<p>\s*' . preg_quote( $token, '/' ) . '\s*<\/p>/', $node, $html );
				}
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

	private static function post_process_html( $html, $theme = '', $allow_visual_markers = false ) {
		$html = TocGenerator::add_heading_ids_and_toc( $html );
		$html = ThemeMarkupTransformer::transform( $html, $theme );

		return self::sanitize_rendered_html( $html, $theme, true, true, $allow_visual_markers );
	}

	private static function sanitize_rendered_html( $html, $theme, $allow_task_inputs = false, $require_task_list_context = false, $allow_visual_markers = false ) {
		$allowed_html             = wp_kses_allowed_html( 'post' );
		$disallowed_form_elements = array(
			'button',
			'fieldset',
			'form',
			'input',
			'option',
			'optgroup',
			'select',
			'textarea',
		);

		foreach ( $disallowed_form_elements as $element ) {
			unset( $allowed_html[ $element ] );
		}

		if ( $allow_task_inputs ) {
			$allowed_html['input'] = array(
				'class'    => true,
				'checked'  => true,
				'disabled' => true,
				'type'     => true,
			);
		}

		if ( $allow_visual_markers ) {
			foreach ( $allowed_html as &$attributes ) {
				if ( is_array( $attributes ) ) {
					$attributes['data-easymde-visual-source-id'] = true;
				}
			}
			unset( $attributes );
		}

		return self::retain_disabled_task_checkboxes( wp_kses( $html, $allowed_html ), $require_task_list_context );
	}

	private static function retain_disabled_task_checkboxes( $html, $require_task_list_context ) {
		$html = (string) $html;

		if ( false === stripos( $html, '<input' ) ) {
			return $html;
		}

		if ( ! class_exists( '\\DOMDocument' ) ) {
			throw new RuntimeException( 'The DOM extension is required to sanitize rendered Markdown inputs.' );
		}

		$document              = new \DOMDocument( '1.0', 'UTF-8' );
		$previous_libxml_state = libxml_use_internal_errors( true );

		try {
			$loaded = $document->loadHTML(
				'<?xml encoding="UTF-8"><div id="easymde-task-list-fragment">' . $html . '</div>',
				LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
			);
		} finally {
			libxml_clear_errors();
			libxml_use_internal_errors( $previous_libxml_state );
		}

		if ( ! $loaded ) {
			throw new RuntimeException( 'Unable to parse rendered Markdown input elements.' );
		}

		$fragment = $document->getElementById( 'easymde-task-list-fragment' );
		if ( ! $fragment instanceof \DOMElement ) {
			throw new RuntimeException( 'Unable to locate the rendered Markdown fragment while sanitizing input elements.' );
		}

		$inputs = array();
		foreach ( $fragment->getElementsByTagName( 'input' ) as $input ) {
			$inputs[] = $input;
		}

		foreach ( $inputs as $input ) {
			$is_allowed_checkbox = self::is_disabled_checkbox( $input )
				&& ( ! $require_task_list_context || self::is_task_list_checkbox( $input ) );

			if ( ! $is_allowed_checkbox ) {
				// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
				$parent = $input->parentNode;
				if ( null === $parent ) {
					throw new RuntimeException( 'Unable to remove a disallowed rendered Markdown input element.' );
				}

				$parent->removeChild( $input );
				continue;
			}

			$checked         = $input->hasAttribute( 'checked' );
			$attribute_names = array();
			foreach ( $input->attributes as $attribute ) {
				$attribute_names[] = $attribute->name;
			}

			foreach ( $attribute_names as $attribute_name ) {
				$input->removeAttribute( $attribute_name );
			}

			if ( $checked ) {
				$input->setAttribute( 'checked', '' );
			}

			$input->setAttribute( 'disabled', '' );
			$input->setAttribute( 'type', 'checkbox' );
		}

		$sanitized_html = '';
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		foreach ( $fragment->childNodes as $node ) {
			$node_html = $document->saveHTML( $node );
			if ( false === $node_html ) {
				throw new RuntimeException( 'Unable to serialize rendered Markdown after sanitizing input elements.' );
			}

			$sanitized_html .= $node_html;
		}

		return $sanitized_html;
	}

	private static function is_disabled_checkbox( \DOMElement $input ) {
		return 'checkbox' === strtolower( $input->getAttribute( 'type' ) ) && $input->hasAttribute( 'disabled' );
	}

	private static function is_task_list_checkbox( \DOMElement $input ) {
		if ( ! self::is_disabled_checkbox( $input ) ) {
			return false;
		}

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		$list_item = $input->parentNode;
		while ( $list_item instanceof \DOMElement && ! self::is_task_list_item( $list_item ) ) {
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
			$list_item = $list_item->parentNode;
		}

		if ( ! $list_item instanceof \DOMElement ) {
			return false;
		}

		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		return $list_item->parentNode instanceof \DOMElement && self::is_task_list( $list_item->parentNode );
	}

	private static function is_task_list_item( \DOMElement $element ) {
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		return 'li' === strtolower( $element->tagName ) && self::has_css_class( $element, 'task-list-item' );
	}

	private static function is_task_list( \DOMElement $element ) {
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Native DOM API property.
		return in_array( strtolower( $element->tagName ), array( 'ul', 'ol' ), true )
			&& ( self::has_css_class( $element, 'task-list' ) || self::has_css_class( $element, 'contains-task-list' ) );
	}

	private static function has_css_class( \DOMElement $element, $class_name ) {
		$classes = explode(
			' ',
			str_replace( array( "\t", "\n", "\f", "\r" ), ' ', trim( $element->getAttribute( 'class' ) ) )
		);

		return in_array( $class_name, $classes, true );
	}
}
