<?php

namespace EasyMDE\Theme;

use EasyMDE\Content\PostDocument;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ThemeStateRepository {

	private $article_themes;
	private $code_themes;
	private $custom_css_policy;
	private $custom_css_user_meta_key    = 'easymde_custom_css_library';
	private $default_theme_user_meta_key = 'easymde_default_theme_state';

	public function __construct(
		ArticleThemeRegistry $article_themes,
		CodeThemeRegistry $code_themes,
		CustomCssPolicy $custom_css_policy
	) {
		$this->article_themes    = $article_themes;
		$this->code_themes       = $code_themes;
		$this->custom_css_policy = $custom_css_policy;
	}

	public function get_theme_options_for_script( $post_id ) {
		$library             = $this->get_custom_css_library( get_current_user_id() );
		$state               = $this->get_theme_state( $post_id );
		$code_theme_explicit = $state['codeThemeExplicit'];
		unset( $state['codeThemeExplicit'] );

		return array(
			'markdownThemes'    => $this->get_article_themes_for_script(),
			'codeThemes'        => $this->code_themes->for_script(),
			'codeThemeExplicit' => $code_theme_explicit,
			'fontOptions'       => $this->get_font_options(),
			'customCss'         => array_values( array_map( array( $this, 'format_custom_css_item' ), $library ) ),
			'state'             => $state,
		);
	}

	public function get_theme_state( $post_id ) {
		$post_id  = absint( $post_id );
		$defaults = $this->get_default_theme_state();

		$markdown_theme          = $defaults['markdownTheme'];
		$code_theme              = $defaults['codeTheme'];
		$custom_css_id           = $defaults['customCssId'];
		$custom_font             = $defaults['customFont'];
		$windows_font            = $defaults['windowsFont'];
		$apple_font              = $defaults['appleFont'];
		$serif_font              = $defaults['serifFont'];
		$custom_css              = '';
		$has_post_font_metadata  = false;
		$has_explicit_code_theme = $defaults['hasExplicitCodeTheme'];

		if ( $post_id ) {
			$stored_markdown_theme = get_post_meta( $post_id, PostDocument::META_MARKDOWN_THEME, true );
			$stored_code_theme     = get_post_meta( $post_id, PostDocument::META_CODE_THEME, true );

			if ( '' !== $stored_markdown_theme ) {
				$markdown_theme          = $stored_markdown_theme;
				$has_explicit_code_theme = false;
			}

			if ( '' !== $stored_code_theme ) {
				$has_explicit_code_theme = $this->is_valid_code_theme_id( $stored_code_theme );
				$code_theme              = $stored_code_theme;
			}

			$custom_css_id = sanitize_key( (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_ID, true ) );
			$custom_css    = (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true );

			$stored_custom_font     = get_post_meta( $post_id, PostDocument::META_CUSTOM_FONT, true );
			$stored_windows_font    = get_post_meta( $post_id, PostDocument::META_WINDOWS_FONT, true );
			$stored_apple_font      = get_post_meta( $post_id, PostDocument::META_APPLE_FONT, true );
			$stored_serif_font      = get_post_meta( $post_id, PostDocument::META_SERIF_FONT, true );
			$has_post_font_metadata = metadata_exists( 'post', $post_id, PostDocument::META_CUSTOM_FONT )
				|| metadata_exists( 'post', $post_id, PostDocument::META_WINDOWS_FONT )
				|| metadata_exists( 'post', $post_id, PostDocument::META_APPLE_FONT )
				|| metadata_exists( 'post', $post_id, PostDocument::META_SERIF_FONT );

			if ( '' !== $stored_custom_font ) {
				$custom_font = $stored_custom_font;
			}

			if ( '' !== $stored_windows_font ) {
				$windows_font = $stored_windows_font;
			}

			if ( '' !== $stored_apple_font ) {
				$apple_font = $stored_apple_font;
			}

			if ( '' !== $stored_serif_font ) {
				$serif_font = $stored_serif_font;
			}
		}

		$apply_theme_font_defaults = $this->should_apply_theme_font_defaults( $custom_font, $windows_font, $apple_font, $serif_font );
		$markdown_theme            = $this->sanitize_markdown_theme_id( $markdown_theme );
		$code_theme                = $has_explicit_code_theme
			? $this->sanitize_code_theme_id( $code_theme )
			: $this->get_associated_code_theme( $markdown_theme );
		$custom_css_id             = sanitize_key( $custom_css_id );
		$custom_font               = $this->sanitize_font_option_id( 'customFonts', $custom_font, 'optima' );
		$windows_font              = $this->sanitize_font_option_id( 'windowsFonts', $windows_font, 'microsoft-yahei' );
		$apple_font                = $this->sanitize_font_option_id( 'appleFonts', $apple_font, 'pingfang-sc-light' );
		$serif_font                = $this->sanitize_font_option_id( 'serifOptions', $serif_font, 'yes' );
		$apply_theme_font_defaults = $apply_theme_font_defaults || $this->should_apply_theme_font_defaults(
			$custom_font,
			$windows_font,
			$apple_font,
			$serif_font
		);
		$apply_theme_font_defaults = $apply_theme_font_defaults || (
			! $has_post_font_metadata
			&& 'crimson-focus' === $defaults['markdownTheme']
			&& $this->is_legacy_crimson_focus_font_stack(
				$custom_font,
				$windows_font,
				$apple_font,
				$serif_font
			)
		);
		$apply_theme_font_defaults = $apply_theme_font_defaults || (
			! $has_post_font_metadata
			&& $markdown_theme !== $defaults['markdownTheme']
			&& $this->font_stack_matches_article_theme_defaults(
				$defaults['markdownTheme'],
				$custom_font,
				$windows_font,
				$apple_font,
				$serif_font
			)
		);

		$theme_font_defaults = $this->get_article_theme_font_defaults( $markdown_theme );
		if ( $theme_font_defaults && $apply_theme_font_defaults ) {
			$custom_font  = $theme_font_defaults['customFont'];
			$windows_font = $theme_font_defaults['windowsFont'];
			$apple_font   = $theme_font_defaults['appleFont'];
			$serif_font   = $theme_font_defaults['serifFont'];
		}

		if ( 'custom' === $markdown_theme && '' === trim( $custom_css ) ) {
			$custom_item = $this->get_custom_css_item( $custom_css_id );
			if ( $custom_item ) {
				$custom_css = $custom_item['css'];
			}
		}

		if ( 'custom' !== $markdown_theme || '' === trim( $custom_css ) ) {
			$custom_css_id = '';
			$custom_css    = '';
			if ( 'custom' === $markdown_theme ) {
				$markdown_theme = 'default';
			}
		}

		return array(
			'markdownTheme'     => $markdown_theme,
			'codeTheme'         => $code_theme,
			'codeThemeExplicit' => $has_explicit_code_theme,
			'customCssId'       => $custom_css_id,
			'customCss'         => $custom_css,
			'scopedCustomCss'   => $this->custom_css_policy->scope( $custom_css ),
			'customFont'        => $custom_font,
			'windowsFont'       => $windows_font,
			'appleFont'         => $apple_font,
			'serifFont'         => $serif_font,
			'fontFamily'        => $this->get_font_stack( $custom_font, $windows_font, $apple_font, $serif_font, $markdown_theme ),
		);
	}

	public function sanitize_markdown_theme_id( $id ) {
		return $this->article_themes->sanitize_id( $id );
	}

	public function sanitize_code_theme_id( $id ) {
		return $this->code_themes->sanitize_id( $id );
	}

	public function get_code_theme( $id ) {
		return $this->code_themes->get( $id );
	}

	public function get_article_theme( $id ) {
		return $this->article_themes->get( $id );
	}

	public function get_custom_css_library( $user_id ) {
		$library = get_user_meta( absint( $user_id ), $this->custom_css_user_meta_key, true );
		if ( ! is_array( $library ) ) {
			return array();
		}

		$normalized = array();
		foreach ( $library as $item ) {
			if (
				! is_array( $item )
				|| empty( $item['id'] )
				|| ! array_key_exists( 'css', $item )
			) {
				continue;
			}

			$id                    = sanitize_key( $item['id'] );
			$legacy_name           = isset( $item['name'] ) ? sanitize_text_field( $item['name'] ) : '';
			$article_theme_name    = isset( $item['article_theme_name'] )
				? sanitize_text_field( $item['article_theme_name'] )
				: $legacy_name;
			$code_theme_name       = isset( $item['code_theme_name'] )
				? sanitize_text_field( $item['code_theme_name'] )
				: $legacy_name;
			$legacy_updated_at     = isset( $item['updatedAt'] ) ? absint( $item['updatedAt'] ) : 0;
			$normalized_updated_at = isset( $item['updated_at'] ) ? absint( $item['updated_at'] ) : $legacy_updated_at;
			if ( '' === $id || '' === $article_theme_name || '' === $code_theme_name ) {
				continue;
			}

			$normalized[ $id ] = array(
				'id'                 => $id,
				'article_theme_name' => $article_theme_name,
				'code_theme_name'    => $code_theme_name,
				'css'                => (string) $item['css'],
				'updated_at'         => $normalized_updated_at,
			);
		}

		return $normalized;
	}

	public function update_custom_css_library( $user_id, array $library ) {
		update_user_meta( absint( $user_id ), $this->custom_css_user_meta_key, array_values( $library ) );
	}

	public function get_custom_css_item( $id ) {
		$library = $this->get_custom_css_library( get_current_user_id() );
		$id      = sanitize_key( $id );

		return isset( $library[ $id ] ) ? $library[ $id ] : null;
	}

	public function format_custom_css_item( $item ) {
		return array(
			'id'               => $item['id'],
			'articleThemeName' => $item['article_theme_name'],
			'codeThemeName'    => $item['code_theme_name'],
			'css'              => $item['css'],
			'scopedCss'        => $this->custom_css_policy->scope( $item['css'] ),
			'updatedAt'        => $item['updated_at'],
		);
	}

	public function unique_custom_css_id( $name, array $library ) {
		$base = sanitize_title( $name );
		if ( '' === $base ) {
			$base = 'custom-css';
		}

		$id     = sanitize_key( $base );
		$suffix = 2;
		while ( isset( $library[ $id ] ) ) {
			$id = sanitize_key( $base . '-' . $suffix );
			++$suffix;
		}

		return $id;
	}

	public function sanitize_theme_state_from_request( $source, $post_id = 0 ) {
		$post_id             = absint( $post_id );
		$markdown_theme      = isset( $source['easymde_markdown_theme'] ) ? wp_unslash( $source['easymde_markdown_theme'] ) : '';
		$code_theme          = isset( $source['easymde_code_theme'] ) ? wp_unslash( $source['easymde_code_theme'] ) : '';
		$code_theme_explicit = isset( $source['easymde_code_theme_explicit'] )
			? wp_unslash( $source['easymde_code_theme_explicit'] )
			: null;
		$custom_css_id       = isset( $source['easymde_custom_css_id'] ) ? wp_unslash( $source['easymde_custom_css_id'] ) : '';
		$custom_font         = isset( $source['easymde_custom_font'] ) ? wp_unslash( $source['easymde_custom_font'] ) : '';
		$windows_font        = isset( $source['easymde_windows_font'] ) ? wp_unslash( $source['easymde_windows_font'] ) : '';
		$apple_font          = isset( $source['easymde_apple_font'] ) ? wp_unslash( $source['easymde_apple_font'] ) : '';
		$serif_font          = isset( $source['easymde_serif_font'] ) ? wp_unslash( $source['easymde_serif_font'] ) : '';

		$explicit_code_theme_requested = null === $code_theme_explicit
			|| '0' !== sanitize_text_field( (string) $code_theme_explicit );
		$has_explicit_code_theme       = $explicit_code_theme_requested
			&& $this->is_valid_code_theme_id( $code_theme );
		$apply_theme_font_defaults     = $this->should_apply_theme_font_defaults( $custom_font, $windows_font, $apple_font, $serif_font );
		$markdown_theme                = $this->sanitize_markdown_theme_id( $markdown_theme );
		$code_theme                    = $has_explicit_code_theme
			? $this->sanitize_code_theme_id( $code_theme )
			: $this->get_associated_code_theme( $markdown_theme );
		$custom_css_id                 = sanitize_key( $custom_css_id );
		$custom_font                   = $this->sanitize_font_option_id( 'customFonts', $custom_font, 'optima' );
		$windows_font                  = $this->sanitize_font_option_id( 'windowsFonts', $windows_font, 'microsoft-yahei' );
		$apple_font                    = $this->sanitize_font_option_id( 'appleFonts', $apple_font, 'pingfang-sc-light' );
		$serif_font                    = $this->sanitize_font_option_id( 'serifOptions', $serif_font, 'yes' );
		$apply_theme_font_defaults     = $apply_theme_font_defaults || $this->should_apply_theme_font_defaults(
			$custom_font,
			$windows_font,
			$apple_font,
			$serif_font
		);

		$theme_font_defaults = $this->get_article_theme_font_defaults( $markdown_theme );
		if ( $theme_font_defaults && $apply_theme_font_defaults ) {
			$custom_font  = $theme_font_defaults['customFont'];
			$windows_font = $theme_font_defaults['windowsFont'];
			$apple_font   = $theme_font_defaults['appleFont'];
			$serif_font   = $theme_font_defaults['serifFont'];
		}

		$custom_css = '';
		if ( 'custom' === $markdown_theme && '' !== $custom_css_id ) {
			$custom_item = $this->get_custom_css_item( $custom_css_id );
			if ( $custom_item ) {
				$custom_css = $custom_item['css'];
			} elseif ( $this->can_preserve_post_custom_css_snapshot( $post_id, $custom_css_id ) ) {
				$custom_css = (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true );
			}
		} else {
			$custom_css_id = '';
		}

		if ( 'custom' === $markdown_theme && '' === trim( $custom_css ) ) {
			$markdown_theme = 'default';
			$custom_css_id  = '';
		}

		return array(
			'markdownTheme'     => $markdown_theme,
			'codeTheme'         => $code_theme,
			'codeThemeExplicit' => $has_explicit_code_theme,
			'customCssId'       => $custom_css_id,
			'customCss'         => $custom_css,
			'customFont'        => $custom_font,
			'windowsFont'       => $windows_font,
			'appleFont'         => $apple_font,
			'serifFont'         => $serif_font,
		);
	}

	private function can_preserve_post_custom_css_snapshot( $post_id, $custom_css_id ) {
		if ( ! $post_id || '' === $custom_css_id ) {
			return false;
		}

		$stored_custom_css_id = sanitize_key( (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_ID, true ) );
		if ( $stored_custom_css_id !== $custom_css_id ) {
			return false;
		}

		return '' !== trim( (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true ) );
	}

	public function save_user_defaults( array $state ) {
		$stored = get_user_meta( get_current_user_id(), $this->default_theme_user_meta_key, true );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$code_theme_explicit = ! array_key_exists( 'codeThemeExplicit', $state ) || ! empty( $state['codeThemeExplicit'] );
		if ( ! $code_theme_explicit ) {
			unset( $stored['codeTheme'] );
		}

		$active_state = array(
			'markdownTheme'   => $state['markdownTheme'],
			'customCssId'     => $state['customCssId'],
			'customFont'      => $state['customFont'],
			'windowsFont'     => $state['windowsFont'],
			'appleFont'       => $state['appleFont'],
			'serifFont'       => $state['serifFont'],
			'defaultsVersion' => EASYMDE_VERSION,
		);
		if ( $code_theme_explicit ) {
			$active_state['codeTheme'] = $state['codeTheme'];
		}

		update_user_meta(
			get_current_user_id(),
			$this->default_theme_user_meta_key,
			array_replace( $stored, $active_state )
		);
	}

	public function get_rendered_content_classes( array $theme_state, $extra = '' ) {
		$classes = array( 'easymde-rendered-content' );

		if ( '' !== $extra ) {
			$classes[] = $extra;
		}

		if ( 'custom' === $theme_state['markdownTheme'] ) {
			$classes[] = 'easymde-markdown-theme-custom';
			$classes[] = 'easymde-custom-css-active';
		} else {
			$classes[] = 'easymde-markdown-theme-' . sanitize_html_class( $theme_state['markdownTheme'] );
		}

		$classes[] = 'easymde-code-theme-' . sanitize_html_class( $theme_state['codeTheme'] );

		$classes[] = 'easymde-code-mac';

		if ( ! empty( $theme_state['fontFamily'] ) ) {
			$classes[] = 'easymde-font-overrides';
			if (
				'crimson-focus' === $theme_state['markdownTheme']
				&& isset( $theme_state['serifFont'] )
				&& 'theme-default' === $theme_state['serifFont']
			) {
				$classes[] = 'easymde-theme-default-fonts';
			}
		}

		return implode( ' ', array_filter( $classes ) );
	}

	public function get_rendered_content_style( array $theme_state ) {
		if ( empty( $theme_state['fontFamily'] ) ) {
			return '';
		}

		return '--easymde-content-font-family: ' . $theme_state['fontFamily'] . ';';
	}

	private function get_default_theme_state() {
		$stored = get_user_meta( get_current_user_id(), $this->default_theme_user_meta_key, true );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$markdown_theme          = $this->sanitize_markdown_theme_id( isset( $stored['markdownTheme'] ) ? $stored['markdownTheme'] : 'default' );
		$stored_code_theme       = isset( $stored['codeTheme'] ) ? $stored['codeTheme'] : '';
		$has_explicit_code_theme = $this->is_valid_code_theme_id( $stored_code_theme );

		return array(
			'markdownTheme'        => $markdown_theme,
			'codeTheme'            => $has_explicit_code_theme
				? $this->sanitize_code_theme_id( $stored_code_theme )
				: $this->get_associated_code_theme( $markdown_theme ),
			'hasExplicitCodeTheme' => $has_explicit_code_theme,
			'customCssId'          => sanitize_key( isset( $stored['customCssId'] ) ? $stored['customCssId'] : '' ),
			'customFont'           => isset( $stored['customFont'] ) ? $stored['customFont'] : 'optima',
			'windowsFont'          => isset( $stored['windowsFont'] ) ? $stored['windowsFont'] : 'microsoft-yahei',
			'appleFont'            => isset( $stored['appleFont'] ) ? $stored['appleFont'] : 'pingfang-sc-light',
			'serifFont'            => isset( $stored['serifFont'] ) ? $stored['serifFont'] : 'yes',
		);
	}

	private function get_associated_code_theme( $markdown_theme ) {
		$theme = $this->article_themes->get( $markdown_theme );
		$id    = isset( $theme['default_code_theme'] ) ? $theme['default_code_theme'] : 'atom-one-dark';

		return $this->sanitize_code_theme_id( $id );
	}

	private function is_valid_code_theme_id( $id ) {
		$id     = sanitize_key( (string) $id );
		$themes = $this->code_themes->all();

		return '' !== $id && isset( $themes[ $id ] );
	}

	private function get_font_options() {
		return array(
			'customFonts'  => array(
				array(
					'id'         => 'none',
					'label'      => _x( 'None', 'font selection option', 'easymde' ),
					'fontFamily' => '',
				),
				array(
					'id'         => 'optima',
					'label'      => __( 'Optima', 'easymde' ),
					'fontFamily' => '"Optima-Regular", "Optima"',
				),
				array(
					'id'         => 'inter',
					'label'      => __( 'Inter', 'easymde' ),
					'fontFamily' => 'Inter',
				),
				array(
					'id'         => 'helvetica',
					'label'      => __( 'Helvetica', 'easymde' ),
					'fontFamily' => 'Helvetica, Arial',
				),
				array(
					'id'         => 'georgia',
					'label'      => __( 'Georgia', 'easymde' ),
					'fontFamily' => '"Georgia"',
				),
				array(
					'id'         => 'times',
					'label'      => __( 'Times', 'easymde' ),
					'fontFamily' => '"Times", "Times New Roman"',
				),
				array(
					'id'         => 'cochin',
					'label'      => __( 'Cochin', 'easymde' ),
					'fontFamily' => '"Cochin"',
				),
				array(
					'id'         => 'helvetica-neue',
					'label'      => __( 'Helvetica Neue', 'easymde' ),
					'fontFamily' => '"Helvetica Neue"',
				),
			),
			'windowsFonts' => array(
				array(
					'id'         => 'microsoft-yahei',
					'label'      => __( 'Microsoft YaHei', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei", "微软雅黑"',
				),
				array(
					'id'         => 'no-windows-font',
					'label'      => _x( 'None', 'font selection option', 'easymde' ),
					'fontFamily' => '',
				),
			),
			'appleFonts'   => array(
				array(
					'id'         => 'pingfang-sc-light',
					'label'      => __( 'PingFang SC Light', 'easymde' ),
					'fontFamily' => '"PingFangSC-light", "PingFangSC-Light"',
				),
				array(
					'id'         => 'pingfang-sc-regular',
					'label'      => __( 'PingFang SC Regular', 'easymde' ),
					'fontFamily' => '"PingFangSC-regular", "PingFang SC"',
				),
				array(
					'id'         => 'pingfang-tc-light',
					'label'      => __( 'PingFang TC Light', 'easymde' ),
					'fontFamily' => '"PingFangTC-light", "PingFangTC-Light"',
				),
				array(
					'id'         => 'pingfang-tc-regular',
					'label'      => __( 'PingFang TC Regular', 'easymde' ),
					'fontFamily' => '"PingFang TC"',
				),
				array(
					'id'         => 'no-apple-font',
					'label'      => _x( 'None', 'font selection option', 'easymde' ),
					'fontFamily' => '',
				),
			),
			'serifOptions' => array(
				array(
					'id'         => 'yes',
					'label'      => _x( 'Yes', 'serif font fallback option', 'easymde' ),
					'fontFamily' => '"Optima-Regular", "Optima", "PingFangSC-light", "PingFangTC-light", "PingFang SC", "Cambria", "Cochin", "Georgia", "Times", "Times New Roman", serif',
				),
				array(
					'id'         => 'serif-only',
					'label'      => __( 'serif', 'easymde' ),
					'fontFamily' => 'serif',
				),
				array(
					'id'         => 'sans-serif-only',
					'label'      => __( 'sans-serif', 'easymde' ),
					'fontFamily' => 'sans-serif',
				),
				array(
					'id'         => 'no',
					'label'      => _x( 'None', 'font selection option', 'easymde' ),
					'fontFamily' => '"Roboto", "Oxygen", "Ubuntu", "Cantarell", "PingFangSC-light", "PingFangTC-light", "Open Sans", "Helvetica Neue", sans-serif',
				),
				array(
					'id'         => 'theme-default',
					'label'      => _x( 'Theme default', 'font selection option', 'easymde' ),
					'fontFamily' => '',
				),
			),
		);
	}

	private function get_font_option( $group, $id ) {
		$options = $this->get_font_options();
		if ( empty( $options[ $group ] ) || ! is_array( $options[ $group ] ) ) {
			return null;
		}

		foreach ( $options[ $group ] as $option ) {
			if ( $option['id'] === $id ) {
				return $option;
			}
		}

		return null;
	}

	private function get_font_stack( $custom_font, $windows_font, $apple_font, $serif_font, $markdown_theme ) {
		$parts         = array();
		$seen          = array();
		$theme_default = 'theme-default' === $serif_font;
		$choices       = array(
			array( 'customFonts', $custom_font ),
			array( 'windowsFonts', $windows_font ),
			array( 'appleFonts', $apple_font ),
			array( 'serifOptions', $serif_font ),
		);

		foreach ( $choices as $choice ) {
			if ( $theme_default && 'serifOptions' === $choice[0] && 'theme-default' === $choice[1] ) {
				continue;
			}
			$option = $this->get_font_option( $choice[0], $choice[1] );
			if ( ! $option || empty( $option['fontFamily'] ) ) {
				continue;
			}

			foreach ( explode( ',', $option['fontFamily'] ) as $font ) {
				$font = trim( $font );
				$key  = strtolower( $font );

				if ( '' !== $font && ! isset( $seen[ $key ] ) ) {
					$seen[ $key ] = true;
					$parts[]      = $font;
				}
			}
		}

		if ( $theme_default && ! empty( $parts ) && $this->article_themes->uses_theme_font_family( $markdown_theme ) ) {
			$parts[] = 'var(--easymde-theme-font-family, sans-serif)';
		}

		return implode( ', ', $parts );
	}

	private function sanitize_font_option_id( $group, $id, $fallback ) {
		$id      = sanitize_key( (string) $id );
		$aliases = $this->get_legacy_font_option_aliases();

		if ( isset( $aliases[ $group ][ $id ] ) ) {
			$id = $aliases[ $group ][ $id ];
		}

		return $this->get_font_option( $group, $id ) ? $id : $fallback;
	}

	private function get_legacy_font_option_aliases() {
		return array(
			'customFonts'  => array(
				'orange-heart-inter'      => 'inter',
				'red-crimson-inter'       => 'inter',
				'rose-purple-optima'      => 'optima',
				'ningye-purple-inter'     => 'inter',
				'cupid-busy-inter'        => 'inter',
				'tech-blue-optima'        => 'optima',
				'qingbi-liujin-helvetica' => 'helvetica',
				'qinghe-zhusha-helvetica' => 'helvetica',
			),
			'windowsFonts' => array(
				'orange-heart-microsoft-yahei'  => 'microsoft-yahei',
				'red-crimson-microsoft-yahei'   => 'microsoft-yahei',
				'rose-purple-microsoft-yahei'   => 'microsoft-yahei',
				'ningye-purple-microsoft-yahei' => 'microsoft-yahei',
				'cupid-busy-microsoft-yahei'    => 'microsoft-yahei',
				'tech-blue-microsoft-yahei'     => 'microsoft-yahei',
				'qingbi-liujin-no-windows'      => 'no-windows-font',
				'qinghe-zhusha-no-windows'      => 'no-windows-font',
			),
			'appleFonts'   => array(
				'pingfang-sc-regular-raw' => 'pingfang-sc-regular',
				'qingbi-liujin-no-apple'  => 'no-apple-font',
				'qinghe-zhusha-no-apple'  => 'no-apple-font',
			),
		);
	}

	private function get_article_themes_for_script() {
		$themes = $this->article_themes->for_script();

		foreach ( $themes as &$theme ) {
			$theme['defaultCodeTheme'] = $this->sanitize_code_theme_id(
				isset( $theme['defaultCodeTheme'] ) ? $theme['defaultCodeTheme'] : 'atom-one-dark'
			);

			$font_defaults = $this->normalize_article_theme_font_defaults(
				isset( $theme['fontDefaults'] ) ? $theme['fontDefaults'] : null
			);
			if ( null === $font_defaults ) {
				unset( $theme['fontDefaults'] );
				continue;
			}

			$theme['fontDefaults'] = $font_defaults;
		}
		unset( $theme );

		return $themes;
	}

	private function get_article_theme_font_defaults( $markdown_theme ) {
		$theme = $this->article_themes->get( $markdown_theme );

		return $this->normalize_article_theme_font_defaults(
			isset( $theme['fontDefaults'] ) ? $theme['fontDefaults'] : null
		);
	}

	private function normalize_article_theme_font_defaults( $font_defaults ) {
		if ( ! is_array( $font_defaults ) ) {
			return null;
		}

		$font_defaults = $this->normalize_known_font_default_aliases( $font_defaults );
		$fields        = array(
			'customFont'  => 'customFonts',
			'windowsFont' => 'windowsFonts',
			'appleFont'   => 'appleFonts',
			'serifFont'   => 'serifOptions',
		);

		foreach ( $fields as $field => $group ) {
			if ( ! isset( $font_defaults[ $field ] ) || ! is_string( $font_defaults[ $field ] ) ) {
				return null;
			}

			$id = sanitize_key( $font_defaults[ $field ] );
			if ( ! $this->get_font_option( $group, $id ) ) {
				return null;
			}

			$font_defaults[ $field ] = $id;
		}

		return $font_defaults;
	}

	private function normalize_known_font_default_aliases( array $font_defaults ) {
		$aliases = $this->get_legacy_font_option_aliases();
		$fields  = array(
			'customFont'  => 'customFonts',
			'windowsFont' => 'windowsFonts',
			'appleFont'   => 'appleFonts',
			'serifFont'   => 'serifOptions',
		);

		foreach ( $fields as $field => $group ) {
			if ( ! isset( $font_defaults[ $field ] ) || ! is_string( $font_defaults[ $field ] ) ) {
				continue;
			}

			$id = sanitize_key( $font_defaults[ $field ] );
			if ( isset( $aliases[ $group ][ $id ] ) ) {
				$font_defaults[ $field ] = $aliases[ $group ][ $id ];
			}
		}

		return $font_defaults;
	}

	private function is_legacy_default_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ) {
		return 'optima' === $custom_font
			&& 'microsoft-yahei' === $windows_font
			&& 'pingfang-sc-light' === $apple_font
			&& 'yes' === $serif_font;
	}

	private function is_legacy_crimson_focus_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ) {
		return 'inter' === $custom_font
			&& 'microsoft-yahei' === $windows_font
			&& 'pingfang-sc-regular' === $apple_font
			&& 'sans-serif-only' === $serif_font;
	}

	private function font_stack_matches_article_theme_defaults( $markdown_theme, $custom_font, $windows_font, $apple_font, $serif_font ) {
		$defaults = $this->get_article_theme_font_defaults( $markdown_theme );

		return $defaults
			&& $defaults['customFont'] === $custom_font
			&& $defaults['windowsFont'] === $windows_font
			&& $defaults['appleFont'] === $apple_font
			&& $defaults['serifFont'] === $serif_font;
	}

	private function should_apply_theme_font_defaults( $custom_font, $windows_font, $apple_font, $serif_font ) {
		$custom_font  = sanitize_key( (string) $custom_font );
		$windows_font = sanitize_key( (string) $windows_font );
		$apple_font   = sanitize_key( (string) $apple_font );
		$serif_font   = sanitize_key( (string) $serif_font );
		$font_stack   = array( $custom_font, $windows_font, $apple_font, $serif_font );

		if ( $this->is_legacy_default_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ) ) {
			return true;
		}

		$legacy_theme_font_stacks = array(
			array( 'orange-heart-inter', 'orange-heart-microsoft-yahei', 'pingfang-sc-regular-raw', 'sans-serif-only' ),
			array( 'red-crimson-inter', 'red-crimson-microsoft-yahei', 'pingfang-sc-regular-raw', 'sans-serif-only' ),
			array( 'rose-purple-optima', 'rose-purple-microsoft-yahei', 'pingfang-sc-regular-raw', 'serif-only' ),
			array( 'ningye-purple-inter', 'ningye-purple-microsoft-yahei', 'pingfang-sc-regular-raw', 'sans-serif-only' ),
			array( 'cupid-busy-inter', 'cupid-busy-microsoft-yahei', 'pingfang-sc-regular-raw', 'sans-serif-only' ),
			array( 'tech-blue-optima', 'tech-blue-microsoft-yahei', 'pingfang-sc-regular-raw', 'serif-only' ),
			array( 'qingbi-liujin-helvetica', 'qingbi-liujin-no-windows', 'qingbi-liujin-no-apple', 'sans-serif-only' ),
			array( 'qinghe-zhusha-helvetica', 'qinghe-zhusha-no-windows', 'qinghe-zhusha-no-apple', 'sans-serif-only' ),
		);

		return in_array( $font_stack, $legacy_theme_font_stacks, true );
	}
}
