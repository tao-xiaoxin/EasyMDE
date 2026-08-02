<?php

namespace EasyMDE\Theme;

use EasyMDE\Support\Asset;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ArticleThemeRegistry {

	public function all() {
		$themes = array(
			'default'         => $this->theme( 'default', __( 'Default theme', 'easymde' ), 'assets/themes/article/default.css', 'atom-one-dark', false, '#1d2327' ),
			'orange-heart'    => $this->theme( 'orange-heart', __( 'Orange heart', 'easymde' ), 'assets/themes/article/orange-heart.css', 'atom-one-dark', true, '#ef7060' ),
			'chazi-purple'    => $this->theme( 'chazi-purple', __( 'Chazi purple', 'easymde' ), 'assets/themes/article/chazi-purple.css', 'atom-one-dark', true, '#773098' ),
			'green-vitality'  => $this->theme( 'green-vitality', __( 'Green vitality', 'easymde' ), 'assets/themes/article/green-vitality.css', 'atom-one-dark', true, '#35b378' ),
			'red-crimson'     => $this->theme( 'red-crimson', __( 'Red crimson', 'easymde' ), 'assets/themes/article/red-crimson.css', 'atom-one-dark', true, '#f83929' ),
			'blue-ying'       => $this->theme( 'blue-ying', __( 'Blue ying', 'easymde' ), 'assets/themes/article/blue-ying.css', 'atom-one-dark', true, '#5c9dff' ),
			'crimson-focus'   => $this->theme( 'crimson-focus', __( 'Crimson focus', 'easymde' ), 'assets/themes/article/crimson-focus.css', 'atom-one-dark', true, '#e74c3c' ),
			'inkwell'         => $this->theme( 'inkwell', __( 'Inkwell', 'easymde' ), 'assets/themes/article/inkwell.css', 'atom-one-dark', true, '#3b82c4' ),
			'nocturne'        => $this->theme( 'nocturne', __( 'Nocturne', 'easymde' ), 'assets/themes/article/nocturne.css', 'atom-one-dark', true, '#b080ff' ),
			'animal-island'   => $this->theme( 'animal-island', __( 'Animal Island', 'easymde' ), 'assets/themes/article/animal-island.css', 'atom-one-dark', true, '#19c8b9' ),
			'phycat-mint'     => $this->theme( 'phycat-mint', __( 'Phycat Mint', 'easymde' ), 'assets/themes/article/phycat-mint.css', 'atom-one-dark', true, '#3db8bf' ),
			'onedark'         => $this->theme( 'onedark', __( 'OneDark', 'easymde' ), 'assets/themes/article/onedark.css', 'atom-one-dark', true, '#3e4249' ),
			'mdmdt'           => $this->theme( 'mdmdt', __( 'Mdmdt Light', 'easymde' ), 'assets/themes/article/mdmdt.css', 'atom-one-dark', true, '#3e69d7' ),
			'dogschoice-pink' => $this->theme( 'dogschoice-pink', __( "Dog's Choice Pink", 'easymde' ), 'assets/themes/article/dogschoice-pink.css', 'atom-one-dark', true, '#f55066' ),
			'bloom-petal'     => $this->theme( 'bloom-petal', __( 'Bloom Petal', 'easymde' ), 'assets/themes/article/bloom-petal.css', 'atom-one-dark', true, '#e8859b' ),
			'spring'          => $this->theme( 'spring', __( 'Spring', 'easymde' ), 'assets/themes/article/spring.css', 'atom-one-dark', true, '#3ea173' ),
			'lanqing'         => $this->theme( 'lanqing', __( 'Lanqing', 'easymde' ), 'assets/themes/article/lanqing.css', 'atom-one-dark', true, '#009688' ),
			'yamabuki'        => $this->theme( 'yamabuki', __( 'Yamabuki', 'easymde' ), 'assets/themes/article/yamabuki.css', 'atom-one-dark', true, '#ffb11b' ),
			'grid-black'      => $this->theme( 'grid-black', __( 'Grid black', 'easymde' ), 'assets/themes/article/grid-black.css', 'atom-one-dark', true, '#212122' ),
			'geek-black'      => $this->theme( 'geek-black', __( 'Geek black', 'easymde' ), 'assets/themes/article/geek-black.css', 'atom-one-dark', true, '#212122' ),
			'rose-purple'     => $this->theme( 'rose-purple', __( 'Rose purple', 'easymde' ), 'assets/themes/article/rose-purple.css', 'atom-one-dark', true, '#916dd5' ),
			'ningye-purple'   => $this->theme( 'ningye-purple', __( 'Ningye purple', 'easymde' ), 'assets/themes/article/ningye-purple.css', 'atom-one-dark', true, '#916dd5' ),
			'tech-blue'       => $this->theme( 'tech-blue', __( 'Tech blue', 'easymde' ), 'assets/themes/article/tech-blue.css', 'atom-one-dark', true, '#0e88eb' ),
			'qingbi-liujin'   => $this->theme( 'qingbi-liujin', __( 'Qingbi Liujin', 'easymde' ), 'assets/themes/article/qingbi-liujin.css', 'atom-one-dark', true, '#1ea089' ),
			'qinghe-zhusha'   => $this->theme( 'qinghe-zhusha', __( 'Qinghe Zhusha', 'easymde' ), 'assets/themes/article/qinghe-zhusha.css', 'atom-one-dark', true, '#4f7f22' ),
			'cute-green'      => $this->theme( 'cute-green', __( 'Cute green', 'easymde' ), 'assets/themes/article/cute-green.css', 'atom-one-dark', true, '#48b378' ),
			'fullstack-blue'  => $this->theme( 'fullstack-blue', __( 'Fullstack blue', 'easymde' ), 'assets/themes/article/fullstack-blue.css', 'fullstack-blue', true, '#40b8fa' ),
			'minimal-black'   => $this->theme( 'minimal-black', __( 'Minimal black', 'easymde' ), 'assets/themes/article/minimal-black.css', 'atom-one-dark', true, '#000000' ),
			'orange-blue'     => $this->theme( 'orange-blue', __( 'Orange blue', 'easymde' ), 'assets/themes/article/orange-blue.css', 'atom-one-dark', true, '#e7642b' ),
			'frontend-peak'   => $this->theme( 'frontend-peak', __( 'Frontend peak', 'easymde' ), 'assets/themes/article/frontend-peak.css', 'atom-one-dark', true, '#3c70c6' ),
			'cupid-busy'      => $this->theme( 'cupid-busy', __( 'Cupid busy', 'easymde' ), 'assets/themes/article/cupid-busy.css', 'atom-one-dark', true, '#827fc4' ),
		);

		foreach ( $themes as $id => $theme ) {
			$font_defaults = $this->font_defaults( $id );
			if ( $font_defaults ) {
				$themes[ $id ]['font_defaults'] = $font_defaults;
				$themes[ $id ]['fontDefaults']  = $font_defaults;
			}
		}

		$filtered_themes = apply_filters( 'easymde_article_themes', $themes );
		foreach ( $filtered_themes as $key => $theme ) {
			$theme_id = isset( $theme['id'] ) ? sanitize_key( $theme['id'] ) : sanitize_key( $key );
			if (
				isset( $themes[ $theme_id ]['swatch'] )
				&& ( ! array_key_exists( 'swatch', $theme ) || null === $theme['swatch'] )
			) {
				$filtered_themes[ $key ]['swatch'] = $themes[ $theme_id ]['swatch'];
			}
		}

		return $filtered_themes;
	}

	public function get( $id ) {
		$themes = $this->all();
		$id     = $this->sanitize_id( $id );

		return isset( $themes[ $id ] ) ? $themes[ $id ] : $themes['default'];
	}

	public function sanitize_id( $id ) {
		$id = sanitize_key( (string) $id );
		if ( 'custom' === $id ) {
			return 'custom';
		}

		$themes = $this->all();

		return isset( $themes[ $id ] ) ? $id : 'default';
	}

	public function for_script() {
		$themes = array();
		foreach ( $this->all() as $theme ) {
			$item   = array(
				'id'               => $theme['id'],
				'label'            => $theme['label'],
				'className'        => $theme['class_name'],
				'cssUrl'           => $this->versioned_asset_url( $theme['asset_path'] ),
				'assetPath'        => $theme['asset_path'],
				'origin'           => $theme['origin'],
				'defaultCodeTheme' => isset( $theme['default_code_theme'] ) ? sanitize_key( $theme['default_code_theme'] ) : 'atom-one-dark',
			);
			$swatch = $this->script_swatch( $theme );
			if ( null !== $swatch ) {
				$item['swatch'] = $swatch;
			}
			if ( ! empty( $theme['uses_theme_font_family'] ) ) {
				$item['usesThemeFontFamily'] = true;
			}

			if ( ! empty( $theme['fontDefaults'] ) ) {
				$item['fontDefaults'] = $theme['fontDefaults'];
			}

			$themes[] = $item;
		}

		return $themes;
	}

	public function font_defaults( $markdown_theme ) {
		switch ( sanitize_key( (string) $markdown_theme ) ) {
			case 'orange-heart':
				return array(
					'customFont'  => 'inter',
					'windowsFont' => 'microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular',
					'serifFont'   => 'sans-serif-only',
				);

			case 'crimson-focus':
				return array(
					'customFont'  => 'none',
					'windowsFont' => 'no-windows-font',
					'appleFont'   => 'no-apple-font',
					'serifFont'   => 'theme-default',
				);

			case 'red-crimson':
				return array(
					'customFont'  => 'inter',
					'windowsFont' => 'microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular',
					'serifFont'   => 'sans-serif-only',
				);

			case 'rose-purple':
				return array(
					'customFont'  => 'optima',
					'windowsFont' => 'microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular',
					'serifFont'   => 'serif-only',
				);

			case 'ningye-purple':
				return array(
					'customFont'  => 'inter',
					'windowsFont' => 'microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular',
					'serifFont'   => 'sans-serif-only',
				);

			case 'cupid-busy':
				return array(
					'customFont'  => 'inter',
					'windowsFont' => 'microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular',
					'serifFont'   => 'sans-serif-only',
				);

			case 'tech-blue':
				return array(
					'customFont'  => 'optima',
					'windowsFont' => 'microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular',
					'serifFont'   => 'serif-only',
				);

			case 'qingbi-liujin':
				return array(
					'customFont'  => 'helvetica',
					'windowsFont' => 'no-windows-font',
					'appleFont'   => 'no-apple-font',
					'serifFont'   => 'sans-serif-only',
				);

			case 'qinghe-zhusha':
				return array(
					'customFont'  => 'helvetica',
					'windowsFont' => 'no-windows-font',
					'appleFont'   => 'no-apple-font',
					'serifFont'   => 'sans-serif-only',
				);
		}

		return null;
	}

	public function uses_theme_font_family( $markdown_theme ) {
		$theme = $this->get( $markdown_theme );

		return ! empty( $theme['uses_theme_font_family'] );
	}

	private function theme( $id, $label, $asset_path, $default_code_theme, $uses_theme_font_family = true, $swatch = null ) {
		return array(
			'id'                     => $id,
			'label'                  => $label,
			'asset_path'             => $asset_path,
			'origin'                 => 'owned',
			'class_name'             => 'easymde-markdown-theme-' . $id,
			'default_code_theme'     => $default_code_theme,
			'uses_theme_font_family' => $uses_theme_font_family,
			'swatch'                 => $swatch,
		);
	}

	private function script_swatch( $theme ) {
		if ( ! array_key_exists( 'swatch', $theme ) || null === $theme['swatch'] ) {
			return null;
		}

		if ( is_string( $theme['swatch'] ) && preg_match( '/\\A#[0-9a-f]{6}\\z/i', $theme['swatch'] ) ) {
			return strtolower( $theme['swatch'] );
		}

		wp_trigger_error(
			__METHOD__,
			'Article theme swatch was ignored (invalid-article-theme-swatch:' . sanitize_key( $theme['id'] ) . ').',
			E_USER_WARNING
		);

		return null;
	}

	private function versioned_asset_url( $asset_path ) {
		return add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( $asset_path ) );
	}
}
