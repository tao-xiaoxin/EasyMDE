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
				// Raw HTML is constrained by the allowlist below. It must reach KSES
				// so supported semantic elements such as details/summary survive.
				'html_input'              => 'allow',
				'allow_unsafe_links'      => false,
				'max_nesting_level'       => self::MAX_NESTING_LEVEL,
				'max_delimiters_per_line' => self::MAX_DELIMITERS_PER_LINE,
				'disallowed_raw_html'     => array(
					'disallowed_tags' => array(
						'title',
						'textarea',
						'style',
						'xmp',
						'iframe',
						'noembed',
						'noframes',
						'script',
						'plaintext',
						'button',
						'fieldset',
						'form',
						'input',
						'option',
						'optgroup',
						'select',
					),
				),
			)
		);

		$html = self::restore_math( self::sanitize_rendered_html( (string) $converter->convert( $markdown ), $theme, true, false ), $math );

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

		return self::sanitize_rendered_html( $html, $theme, true, true );
	}

	private static function sanitize_rendered_html( $html, $theme, $allow_task_inputs = false, $require_task_list_context = false ) {
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

		$allowed_html['details'] = array(
			'open' => true,
		);
		$allowed_html['summary'] = array();

		if ( $allow_task_inputs ) {
			$allowed_html['input'] = array(
				'class'    => true,
				'checked'  => true,
				'disabled' => true,
				'type'     => true,
			);
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
