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
		$library = $this->get_custom_css_library( get_current_user_id() );

		return array(
			'markdownThemes' => $this->article_themes->for_script(),
			'codeThemes'     => $this->code_themes->for_script(),
			'fontOptions'    => $this->get_font_options(),
			'customCss'      => array_values( array_map( array( $this, 'format_custom_css_item' ), $library ) ),
			'state'          => $this->get_theme_state( $post_id ),
		);
	}

	public function get_theme_state( $post_id ) {
		$post_id  = absint( $post_id );
		$defaults = $this->get_default_theme_state();

		$markdown_theme = $defaults['markdownTheme'];
		$code_theme     = $defaults['codeTheme'];
		$code_mac_style = $defaults['codeMacStyle'];
		$custom_css_id  = $defaults['customCssId'];
		$custom_font    = $defaults['customFont'];
		$windows_font   = $defaults['windowsFont'];
		$apple_font     = $defaults['appleFont'];
		$serif_font     = $defaults['serifFont'];
		$custom_css     = '';

		if ( $post_id ) {
			$stored_markdown_theme = get_post_meta( $post_id, PostDocument::META_MARKDOWN_THEME, true );
			$stored_code_theme     = get_post_meta( $post_id, PostDocument::META_CODE_THEME, true );

			if ( '' !== $stored_markdown_theme ) {
				$markdown_theme = $stored_markdown_theme;
			}

			if ( '' !== $stored_code_theme ) {
				$code_theme = $stored_code_theme;
			}

			$stored_code_mac_style = get_post_meta( $post_id, PostDocument::META_CODE_MAC_STYLE, true );
			if ( '' !== $stored_code_mac_style ) {
				$code_mac_style = '1' === $stored_code_mac_style;
			}

			$custom_css_id = sanitize_key( (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_ID, true ) );
			$custom_css    = (string) get_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, true );

			$stored_custom_font  = get_post_meta( $post_id, PostDocument::META_CUSTOM_FONT, true );
			$stored_windows_font = get_post_meta( $post_id, PostDocument::META_WINDOWS_FONT, true );
			$stored_apple_font   = get_post_meta( $post_id, PostDocument::META_APPLE_FONT, true );
			$stored_serif_font   = get_post_meta( $post_id, PostDocument::META_SERIF_FONT, true );

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

		$markdown_theme = $this->sanitize_markdown_theme_id( $markdown_theme );
		$code_theme     = $this->sanitize_code_theme_id( $code_theme );
		$custom_css_id  = sanitize_key( $custom_css_id );
		$custom_font    = $this->sanitize_font_option_id( 'customFonts', $custom_font, 'optima' );
		$windows_font   = $this->sanitize_font_option_id( 'windowsFonts', $windows_font, 'microsoft-yahei' );
		$apple_font     = $this->sanitize_font_option_id( 'appleFonts', $apple_font, 'pingfang-sc-light' );
		$serif_font     = $this->sanitize_font_option_id( 'serifOptions', $serif_font, 'yes' );

		$theme_font_defaults = $this->article_themes->font_defaults( $markdown_theme );
		if ( $theme_font_defaults && $this->should_apply_theme_font_defaults( $custom_font, $windows_font, $apple_font, $serif_font ) ) {
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
			'markdownTheme'   => $markdown_theme,
			'codeTheme'       => $code_theme,
			'codeMacStyle'    => (bool) $code_mac_style,
			'customCssId'     => $custom_css_id,
			'customCss'       => $custom_css,
			'scopedCustomCss' => $this->custom_css_policy->scope( $custom_css ),
			'customFont'      => $custom_font,
			'windowsFont'     => $windows_font,
			'appleFont'       => $apple_font,
			'serifFont'       => $serif_font,
			'fontFamily'      => $this->get_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ),
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
			if ( ! is_array( $item ) || empty( $item['id'] ) || empty( $item['name'] ) || ! array_key_exists( 'css', $item ) ) {
				continue;
			}

			$id = sanitize_key( $item['id'] );
			if ( '' === $id ) {
				continue;
			}

			$normalized[ $id ] = array(
				'id'        => $id,
				'name'      => sanitize_text_field( $item['name'] ),
				'css'       => (string) $item['css'],
				'updatedAt' => isset( $item['updatedAt'] ) ? absint( $item['updatedAt'] ) : 0,
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
			'id'        => $item['id'],
			'name'      => $item['name'],
			'css'       => $item['css'],
			'scopedCss' => $this->custom_css_policy->scope( $item['css'] ),
			'updatedAt' => $item['updatedAt'],
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
		$post_id        = absint( $post_id );
		$markdown_theme = $this->sanitize_markdown_theme_id( isset( $source['easymde_markdown_theme'] ) ? wp_unslash( $source['easymde_markdown_theme'] ) : '' );
		$code_theme     = $this->sanitize_code_theme_id( isset( $source['easymde_code_theme'] ) ? wp_unslash( $source['easymde_code_theme'] ) : '' );
		$code_mac_style = ! empty( $source['easymde_code_mac_style'] ) && '0' !== (string) wp_unslash( $source['easymde_code_mac_style'] );
		$custom_css_id  = sanitize_key( isset( $source['easymde_custom_css_id'] ) ? wp_unslash( $source['easymde_custom_css_id'] ) : '' );
		$custom_font    = $this->sanitize_font_option_id( 'customFonts', isset( $source['easymde_custom_font'] ) ? wp_unslash( $source['easymde_custom_font'] ) : '', 'optima' );
		$windows_font   = $this->sanitize_font_option_id( 'windowsFonts', isset( $source['easymde_windows_font'] ) ? wp_unslash( $source['easymde_windows_font'] ) : '', 'microsoft-yahei' );
		$apple_font     = $this->sanitize_font_option_id( 'appleFonts', isset( $source['easymde_apple_font'] ) ? wp_unslash( $source['easymde_apple_font'] ) : '', 'pingfang-sc-light' );
		$serif_font     = $this->sanitize_font_option_id( 'serifOptions', isset( $source['easymde_serif_font'] ) ? wp_unslash( $source['easymde_serif_font'] ) : '', 'yes' );

		$theme_font_defaults = $this->article_themes->font_defaults( $markdown_theme );
		if ( $theme_font_defaults && $this->should_apply_theme_font_defaults( $custom_font, $windows_font, $apple_font, $serif_font ) ) {
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
			'markdownTheme' => $markdown_theme,
			'codeTheme'     => $code_theme,
			'codeMacStyle'  => (bool) $code_mac_style,
			'customCssId'   => $custom_css_id,
			'customCss'     => $custom_css,
			'customFont'    => $custom_font,
			'windowsFont'   => $windows_font,
			'appleFont'     => $apple_font,
			'serifFont'     => $serif_font,
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
		update_user_meta(
			get_current_user_id(),
			$this->default_theme_user_meta_key,
			array(
				'markdownTheme'   => $state['markdownTheme'],
				'codeTheme'       => $state['codeTheme'],
				'codeMacStyle'    => (bool) $state['codeMacStyle'],
				'customCssId'     => $state['customCssId'],
				'customFont'      => $state['customFont'],
				'windowsFont'     => $state['windowsFont'],
				'appleFont'       => $state['appleFont'],
				'serifFont'       => $state['serifFont'],
				'defaultsVersion' => EASYMDE_VERSION,
			)
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

		if ( ! empty( $theme_state['codeMacStyle'] ) ) {
			$classes[] = 'easymde-code-mac';
		}

		if ( ! empty( $theme_state['fontFamily'] ) ) {
			$classes[] = 'easymde-font-overrides';
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

		$stored_code_theme     = isset( $stored['codeTheme'] ) ? $stored['codeTheme'] : 'atom-one-dark';
		$stored_code_mac_style = array_key_exists( 'codeMacStyle', $stored ) ? ! empty( $stored['codeMacStyle'] ) : true;

		if ( empty( $stored['defaultsVersion'] ) && 'github' === $stored_code_theme && ! $stored_code_mac_style ) {
			$stored_code_theme     = 'atom-one-dark';
			$stored_code_mac_style = true;
		}

		return array(
			'markdownTheme' => $this->sanitize_markdown_theme_id( isset( $stored['markdownTheme'] ) ? $stored['markdownTheme'] : 'default' ),
			'codeTheme'     => $this->sanitize_code_theme_id( $stored_code_theme ),
			'codeMacStyle'  => $stored_code_mac_style,
			'customCssId'   => sanitize_key( isset( $stored['customCssId'] ) ? $stored['customCssId'] : '' ),
			'customFont'    => $this->sanitize_font_option_id( 'customFonts', isset( $stored['customFont'] ) ? $stored['customFont'] : 'optima', 'optima' ),
			'windowsFont'   => $this->sanitize_font_option_id( 'windowsFonts', isset( $stored['windowsFont'] ) ? $stored['windowsFont'] : 'microsoft-yahei', 'microsoft-yahei' ),
			'appleFont'     => $this->sanitize_font_option_id( 'appleFonts', isset( $stored['appleFont'] ) ? $stored['appleFont'] : 'pingfang-sc-light', 'pingfang-sc-light' ),
			'serifFont'     => $this->sanitize_font_option_id( 'serifOptions', isset( $stored['serifFont'] ) ? $stored['serifFont'] : 'yes', 'yes' ),
		);
	}

	private function get_font_options() {
		return array(
			'customFonts'  => array(
				array(
					'id'         => 'none',
					'label'      => __( 'No custom font', 'easymde' ),
					'fontFamily' => '',
				),
				array(
					'id'         => 'optima',
					'label'      => __( 'Optima', 'easymde' ),
					'fontFamily' => '"Optima-Regular", "Optima"',
				),
				array(
					'id'         => 'orange-heart-inter',
					'label'      => __( 'Inter (orange-heart)', 'easymde' ),
					'fontFamily' => 'Inter',
				),
				array(
					'id'         => 'red-crimson-inter',
					'label'      => __( 'Inter (red-crimson)', 'easymde' ),
					'fontFamily' => 'Inter',
				),
				array(
					'id'         => 'rose-purple-optima',
					'label'      => __( 'Optima (rose-purple)', 'easymde' ),
					'fontFamily' => 'Optima',
				),
				array(
					'id'         => 'ningye-purple-inter',
					'label'      => __( 'Inter (ningye-purple)', 'easymde' ),
					'fontFamily' => 'Inter',
				),
				array(
					'id'         => 'cupid-busy-inter',
					'label'      => __( 'Inter (cupid-busy)', 'easymde' ),
					'fontFamily' => 'Inter',
				),
				array(
					'id'         => 'tech-blue-optima',
					'label'      => __( 'Optima (tech-blue)', 'easymde' ),
					'fontFamily' => 'Optima',
				),
				array(
					'id'         => 'qinghe-zhusha-helvetica',
					'label'      => __( 'Helvetica (qinghe-zhusha)', 'easymde' ),
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
					'id'         => 'orange-heart-microsoft-yahei',
					'label'      => __( 'Microsoft YaHei (orange-heart)', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei"',
				),
				array(
					'id'         => 'red-crimson-microsoft-yahei',
					'label'      => __( 'Microsoft YaHei (red-crimson)', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei"',
				),
				array(
					'id'         => 'rose-purple-microsoft-yahei',
					'label'      => __( 'Microsoft YaHei (rose-purple)', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei"',
				),
				array(
					'id'         => 'ningye-purple-microsoft-yahei',
					'label'      => __( 'Microsoft YaHei (ningye-purple)', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei"',
				),
				array(
					'id'         => 'cupid-busy-microsoft-yahei',
					'label'      => __( 'Microsoft YaHei (cupid-busy)', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei"',
				),
				array(
					'id'         => 'tech-blue-microsoft-yahei',
					'label'      => __( 'Microsoft YaHei (tech-blue)', 'easymde' ),
					'fontFamily' => '"Microsoft YaHei"',
				),
				array(
					'id'         => 'qinghe-zhusha-no-windows',
					'label'      => __( 'No Windows-specific font (qinghe-zhusha)', 'easymde' ),
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
					'id'         => 'pingfang-sc-regular-raw',
					'label'      => __( 'PingFangSC-regular', 'easymde' ),
					'fontFamily' => 'PingFangSC-regular',
				),
				array(
					'id'         => 'pingfang-sc-regular',
					'label'      => __( 'PingFang SC Regular', 'easymde' ),
					'fontFamily' => '"PingFang SC"',
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
					'id'         => 'qinghe-zhusha-no-apple',
					'label'      => __( 'No Apple-specific font (qinghe-zhusha)', 'easymde' ),
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
					'label'      => _x( 'No', 'serif font fallback option', 'easymde' ),
					'fontFamily' => '"Roboto", "Oxygen", "Ubuntu", "Cantarell", "PingFangSC-light", "PingFangTC-light", "Open Sans", "Helvetica Neue", sans-serif',
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

	private function get_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ) {
		$parts   = array();
		$seen    = array();
		$choices = array(
			array( 'customFonts', $custom_font ),
			array( 'windowsFonts', $windows_font ),
			array( 'appleFonts', $apple_font ),
			array( 'serifOptions', $serif_font ),
		);

		foreach ( $choices as $choice ) {
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

		return implode( ', ', $parts );
	}

	private function sanitize_font_option_id( $group, $id, $fallback ) {
		$id = sanitize_key( (string) $id );

		return $this->get_font_option( $group, $id ) ? $id : $fallback;
	}

	private function is_legacy_default_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ) {
		return 'optima' === $custom_font
			&& 'microsoft-yahei' === $windows_font
			&& 'pingfang-sc-light' === $apple_font
			&& 'yes' === $serif_font;
	}

	private function should_apply_theme_font_defaults( $custom_font, $windows_font, $apple_font, $serif_font ) {
		if ( $this->is_legacy_default_font_stack( $custom_font, $windows_font, $apple_font, $serif_font ) ) {
			return true;
		}

		foreach ( array( 'orange-heart', 'red-crimson', 'rose-purple', 'ningye-purple', 'cupid-busy', 'tech-blue', 'qinghe-zhusha' ) as $theme_id ) {
			$defaults = $this->article_themes->font_defaults( $theme_id );
			if (
				$defaults
				&& $defaults['customFont'] === $custom_font
				&& $defaults['windowsFont'] === $windows_font
				&& $defaults['appleFont'] === $apple_font
				&& $defaults['serifFont'] === $serif_font
			) {
				return true;
			}
		}

		return false;
	}
}
