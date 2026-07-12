<?php

namespace EasyMDE\Theme;

use Sabberworm\CSS\CSSList\CSSList;
use Sabberworm\CSS\CSSList\KeyFrame;
use Sabberworm\CSS\OutputFormat;
use Sabberworm\CSS\Parser;
use Sabberworm\CSS\Property\AtRule;
use Sabberworm\CSS\RuleSet\DeclarationBlock;
use Sabberworm\CSS\RuleSet\RuleSet;
use Sabberworm\CSS\Settings;
use Sabberworm\CSS\Value\URL;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class CustomCssPolicy {

	const MAX_BYTES = 30000;
	const SCOPE         = '.easymde-rendered-content.easymde-custom-css-active';
	const PREVIEW_SCOPE = '.easymde-immersive-workspace__custom-css-preview-content';

	public function normalize_for_storage( $css ) {
		return $this->render_css( (string) $css, '' );
	}

	public function scope( $css ) {
		$scoped = $this->render_css( (string) $css, self::SCOPE );

		return is_wp_error( $scoped ) ? '' : $scoped;
	}

	public function prepare_preview( $css ) {
		$normalized = $this->normalize_for_storage( $css );
		if ( is_wp_error( $normalized ) ) {
			return $normalized;
		}

		$scoped = $this->render_css( $normalized, self::PREVIEW_SCOPE );
		if ( is_wp_error( $scoped ) ) {
			return $scoped;
		}

		return array(
			'css'       => $normalized,
			'scopedCss' => $scoped,
		);
	}

	public function validate( $css ) {
		$result = $this->normalize_for_storage( $css );

		return is_wp_error( $result ) ? $result : true;
	}

	private function render_css( $css, $scope ) {
		$css = (string) $css;
		if ( strlen( $css ) > self::MAX_BYTES ) {
			return new WP_Error(
				'easymde_custom_css_too_large',
				__( 'Custom CSS is too large.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		$css = $this->prepare_raw_css( $css );
		if ( '' === $css ) {
			return '';
		}

		if ( ! class_exists( Parser::class ) ) {
			return new WP_Error(
				'easymde_css_parser_missing',
				__( 'The CSS parser dependency is unavailable. Custom CSS cannot be rendered safely.', 'easymde' ),
				array( 'status' => 500 )
			);
		}

		$blocked = $this->find_blocked_token( $css );
		if ( $blocked ) {
			return $this->blocked_error( $blocked );
		}

		try {
			$parser   = new Parser( $css, Settings::create()->beStrict() );
			$document = $parser->parse();
			$this->assert_safe_node( $document );

			if ( '' !== $scope ) {
				$this->scope_node( $document, false, $scope );
			}

			return trim( $document->render( OutputFormat::create() ) );
		} catch ( \Exception $exception ) {
			return new WP_Error(
				'easymde_invalid_custom_css',
				sprintf(
					/* translators: %s: CSS parser error message. */
					__( 'Custom CSS could not be parsed safely: %s', 'easymde' ),
					$exception->getMessage()
				),
				array( 'status' => 400 )
			);
		}
	}

	private function prepare_raw_css( $css ) {
		$css = wp_strip_all_tags( (string) $css );
		$css = str_replace( array( "\0", '</style', '<style' ), '', $css );

		return trim( $css );
	}

	private function find_blocked_token( $css ) {
		$patterns = array(
			'/@import\b/i'        => '@import',
			'/@charset\b/i'       => '@charset',
			'/@font-face\b/i'     => '@font-face',
			'/url\s*\(/i'         => 'url()',
			'/expression\s*\(/i'  => 'expression()',
			'/\bbehavior\s*:/i'   => 'behavior',
			'/-moz-binding\s*:/i' => '-moz-binding',
			'/javascript\s*:/i'   => 'javascript:',
		);

		foreach ( $patterns as $pattern => $label ) {
			if ( preg_match( $pattern, $css ) ) {
				return $label;
			}
		}

		return '';
	}

	private function assert_safe_node( $node ) {
		if ( $node instanceof AtRule ) {
				$name = strtolower( (string) $node->atRuleName() );
			if ( ! in_array( $name, array( 'media', 'supports', 'keyframes', '-webkit-keyframes' ), true ) ) {
				throw new \RuntimeException( '@' . esc_html( $name ) . ' is not allowed.' );
			}

			if ( method_exists( $node, 'atRuleArgs' ) ) {
				$args = strtolower( (string) $node->atRuleArgs() );
				if ( false !== strpos( $args, 'url(' ) || false !== strpos( $args, 'javascript:' ) ) {
					throw new \RuntimeException( '@' . esc_html( $name ) . ' contains a blocked value.' );
				}
			}
		}

		if ( $node instanceof RuleSet ) {
			foreach ( $node->getRules() as $rule ) {
					$name = strtolower( (string) $rule->getRule() );
				if ( in_array( $name, array( 'behavior', '-moz-binding' ), true ) ) {
					throw new \RuntimeException( esc_html( $name ) . ' is not allowed.' );
				}

				$value = $rule->getValue();
				if ( $value instanceof URL ) {
					throw new \RuntimeException( 'url() is not allowed.' );
				}

				$value_string = strtolower( (string) $value );
				if (
					false !== strpos( $value_string, 'url(' )
					|| false !== strpos( $value_string, 'expression(' )
					|| false !== strpos( $value_string, 'javascript:' )
					) {
						throw new \RuntimeException( esc_html( $name ) . ' contains a blocked value.' );
				}
			}
		}

		if ( $node instanceof CSSList ) {
			foreach ( $node->getContents() as $child ) {
				$this->assert_safe_node( $child );
			}
		}
	}

	private function scope_node( $node, $inside_keyframes, $scope ) {
		$is_keyframe = $inside_keyframes || $node instanceof KeyFrame;

		if ( $node instanceof DeclarationBlock && ! $is_keyframe ) {
			$scoped_selectors = array();
			foreach ( $node->getSelectors() as $selector ) {
				$selector = trim( (string) $selector );
				if ( '' === $selector ) {
					continue;
				}

				if ( 0 === strpos( $selector, $scope ) ) {
					$scoped_selectors[] = $selector;
				} elseif ( ':root' === $selector ) {
					$scoped_selectors[] = $scope;
				} elseif ( 0 === strpos( $selector, ':root ' ) ) {
					$scoped_selectors[] = $scope . substr( $selector, 5 );
				} else {
					$scoped_selectors[] = $scope . ' ' . $selector;
				}
			}

			if ( ! empty( $scoped_selectors ) ) {
				$node->setSelectors( $scoped_selectors );
			}
		}

		if ( $node instanceof CSSList ) {
			foreach ( $node->getContents() as $child ) {
				$this->scope_node( $child, $is_keyframe, $scope );
			}
		}
	}

	private function blocked_error( $blocked ) {
		return new WP_Error(
			'easymde_blocked_custom_css',
			sprintf(
				/* translators: %s: blocked CSS feature. */
				__( 'Custom CSS contains a blocked feature: %s', 'easymde' ),
				$blocked
			),
			array( 'status' => 400 )
		);
	}
}
