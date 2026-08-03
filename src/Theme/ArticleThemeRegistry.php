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
			'inkwell'         => $this->theme( 'inkwell', __( '墨砚', 'easymde' ), 'assets/themes/article/inkwell.css', 'inkwell-code', true, '#3b82c4' ),
			'animal-island'   => $this->theme( 'animal-island', __( '动物岛', 'easymde' ), 'assets/themes/article/animal-island.css', 'animal-island-code', true, '#19c8b9' ),
			'phycat-cherry'   => $this->theme( 'phycat-cherry', __( '樱桃猫', 'easymde' ), 'assets/themes/article/phycat-cherry.css', 'phycat-code', true, '#aa1111' ),
			'phycat-caramel'  => $this->theme( 'phycat-caramel', __( '焦糖猫', 'easymde' ), 'assets/themes/article/phycat-caramel.css', 'phycat-code', true, '#f59e0b' ),
			'phycat-forest'   => $this->theme( 'phycat-forest', __( '森林猫', 'easymde' ), 'assets/themes/article/phycat-forest.css', 'phycat-code', true, '#11aa63' ),
			'phycat-mint'     => $this->theme( 'phycat-mint', __( '薄荷猫', 'easymde' ), 'assets/themes/article/phycat-mint.css', 'phycat-code', true, '#3db8bf' ),
			'phycat-sky'      => $this->theme( 'phycat-sky', __( '天蓝猫', 'easymde' ), 'assets/themes/article/phycat-sky.css', 'phycat-code', true, '#3498db' ),
			'phycat-prussian' => $this->theme( 'phycat-prussian', __( '普鲁士猫', 'easymde' ), 'assets/themes/article/phycat-prussian.css', 'phycat-code', true, '#1d4e89' ),
			'phycat-sakura'   => $this->theme( 'phycat-sakura', __( '樱花猫', 'easymde' ), 'assets/themes/article/phycat-sakura.css', 'phycat-code', true, '#ff7096' ),
			'phycat-mauve'    => $this->theme( 'phycat-mauve', __( '淡紫猫', 'easymde' ), 'assets/themes/article/phycat-mauve.css', 'phycat-code', true, '#a06eb4' ),
			'mdmdt'           => $this->theme( 'mdmdt', __( 'Mdmdt 浅色', 'easymde' ), 'assets/themes/article/mdmdt.css', 'mdmdt-code', true, '#3e69d7' ),
			'dogschoice-pink' => $this->theme( 'dogschoice-pink', __( '狗狗粉', 'easymde' ), 'assets/themes/article/dogschoice-pink.css', 'dogschoice-pink-code', true, '#f55066' ),
			'bloom-petal'     => $this->theme( 'bloom-petal', __( '花瓣', 'easymde' ), 'assets/themes/article/bloom-petal.css', 'bloom-petal-code', true, '#e63f9f' ),
			'bloom-mist'      => $this->theme( 'bloom-mist', __( '雾蓝', 'easymde' ), 'assets/themes/article/bloom-mist.css', 'bloom-mist-code', true, '#34698c' ),
			'bloom-verdant'   => $this->theme( 'bloom-verdant', __( '草木', 'easymde' ), 'assets/themes/article/bloom-verdant.css', 'bloom-verdant-code', true, '#3d7055' ),
			'bloom-stone'     => $this->theme( 'bloom-stone', __( '暖石', 'easymde' ), 'assets/themes/article/bloom-stone.css', 'bloom-stone-code', true, '#82564f' ),
			'bloom-wheat'     => $this->theme( 'bloom-wheat', __( '麦穗', 'easymde' ), 'assets/themes/article/bloom-wheat.css', 'bloom-wheat-code', true, '#947d53' ),
			'bloom-ink'       => $this->theme( 'bloom-ink', __( '水墨', 'easymde' ), 'assets/themes/article/bloom-ink.css', 'bloom-ink-code', true, '#a74639' ),
			'bloom-amber'     => $this->theme( 'bloom-amber', __( '琥珀', 'easymde' ), 'assets/themes/article/bloom-amber.css', 'bloom-amber-code', true, '#b77b29' ),
			'bloom-lapis'     => $this->theme( 'bloom-lapis', __( '青金', 'easymde' ), 'assets/themes/article/bloom-lapis.css', 'bloom-lapis-code', true, '#2f62ac' ),
			'bloom-ripple'    => $this->theme( 'bloom-ripple', __( '涟漪', 'easymde' ), 'assets/themes/article/bloom-ripple.css', 'bloom-ripple-code', true, '#009c9c' ),
			'bloom-cinnabar'  => $this->theme( 'bloom-cinnabar', __( '丹红', 'easymde' ), 'assets/themes/article/bloom-cinnabar.css', 'bloom-cinnabar-code', true, '#c53637' ),
			'bloom-sage'      => $this->theme( 'bloom-sage', __( '鼠尾草', 'easymde' ), 'assets/themes/article/bloom-sage.css', 'bloom-sage-code', true, '#848e38' ),
			'bloom-spring'    => $this->theme( 'bloom-spring', __( '紫语', 'easymde' ), 'assets/themes/article/bloom-spring.css', 'bloom-spring-code', true, '#877deb' ),
			'spring'          => $this->theme( 'spring', __( '春日', 'easymde' ), 'assets/themes/article/spring.css', 'spring-code', true, '#3ea173' ),
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
