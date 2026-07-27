<?php

namespace EasyMDE\Theme;

use EasyMDE\Support\Asset;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ArticleThemeRegistry {

	public function all() {
		$themes = array(
			'default'        => $this->theme( 'default', __( 'Default theme', 'easymde' ), 'assets/themes/article/default.css', 'atom-one-dark' ),
			'orange-heart'   => $this->theme( 'orange-heart', __( 'Orange heart', 'easymde' ), 'assets/themes/article/orange-heart.css', 'atom-one-dark' ),
			'chazi-purple'   => $this->theme( 'chazi-purple', __( 'Chazi purple', 'easymde' ), 'assets/themes/article/chazi-purple.css', 'atom-one-dark' ),
			'nenqing-green'  => $this->theme( 'nenqing-green', __( 'Nenqing green', 'easymde' ), 'assets/themes/article/nenqing-green.css', 'atom-one-dark' ),
			'green-vitality' => $this->theme( 'green-vitality', __( 'Green vitality', 'easymde' ), 'assets/themes/article/green-vitality.css', 'atom-one-dark' ),
			'red-crimson'    => $this->theme( 'red-crimson', __( 'Red crimson', 'easymde' ), 'assets/themes/article/red-crimson.css', 'atom-one-dark' ),
			'blue-ying'      => $this->theme( 'blue-ying', __( 'Blue ying', 'easymde' ), 'assets/themes/article/blue-ying.css', 'atom-one-dark' ),
			'lanqing'        => $this->theme( 'lanqing', __( 'Lanqing', 'easymde' ), 'assets/themes/article/lanqing.css', 'atom-one-dark' ),
			'yamabuki'       => $this->theme( 'yamabuki', __( 'Yamabuki', 'easymde' ), 'assets/themes/article/yamabuki.css', 'atom-one-dark' ),
			'grid-black'     => $this->theme( 'grid-black', __( 'Grid black', 'easymde' ), 'assets/themes/article/grid-black.css', 'atom-one-dark' ),
			'geek-black'     => $this->theme( 'geek-black', __( 'Geek black', 'easymde' ), 'assets/themes/article/geek-black.css', 'atom-one-dark' ),
			'rose-purple'    => $this->theme( 'rose-purple', __( 'Rose purple', 'easymde' ), 'assets/themes/article/rose-purple.css', 'atom-one-dark' ),
			'ningye-purple'  => $this->theme( 'ningye-purple', __( 'Ningye purple', 'easymde' ), 'assets/themes/article/ningye-purple.css', 'atom-one-dark' ),
			'tech-blue'      => $this->theme( 'tech-blue', __( 'Tech blue', 'easymde' ), 'assets/themes/article/tech-blue.css', 'atom-one-dark' ),
			'qingbi-liujin'  => $this->theme( 'qingbi-liujin', __( 'Qingbi Liujin', 'easymde' ), 'assets/themes/article/qingbi-liujin.css', 'atom-one-dark' ),
			'qinghe-zhusha'  => $this->theme( 'qinghe-zhusha', __( 'Qinghe Zhusha', 'easymde' ), 'assets/themes/article/qinghe-zhusha.css', 'atom-one-dark' ),
			'cute-green'     => $this->theme( 'cute-green', __( 'Cute green', 'easymde' ), 'assets/themes/article/cute-green.css', 'atom-one-dark' ),
			'fullstack-blue' => $this->theme( 'fullstack-blue', __( 'Fullstack blue', 'easymde' ), 'assets/themes/article/fullstack-blue.css', 'fullstack-blue' ),
			'minimal-black'  => $this->theme( 'minimal-black', __( 'Minimal black', 'easymde' ), 'assets/themes/article/minimal-black.css', 'atom-one-dark' ),
			'orange-blue'    => $this->theme( 'orange-blue', __( 'Orange blue', 'easymde' ), 'assets/themes/article/orange-blue.css', 'atom-one-dark' ),
			'frontend-peak'  => $this->theme( 'frontend-peak', __( 'Frontend peak', 'easymde' ), 'assets/themes/article/frontend-peak.css', 'atom-one-dark' ),
			'cupid-busy'     => $this->theme( 'cupid-busy', __( 'Cupid busy', 'easymde' ), 'assets/themes/article/cupid-busy.css', 'atom-one-dark' ),
		);

		foreach ( $themes as $id => $theme ) {
			$font_defaults = $this->font_defaults( $id );
			if ( $font_defaults ) {
				$themes[ $id ]['font_defaults'] = $font_defaults;
				$themes[ $id ]['fontDefaults']  = $font_defaults;
			}
		}

		return apply_filters( 'easymde_article_themes', $themes );
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
			$item = array(
				'id'               => $theme['id'],
				'label'            => $theme['label'],
				'className'        => $theme['class_name'],
				'cssUrl'           => $this->versioned_asset_url( $theme['asset_path'] ),
				'assetPath'        => $theme['asset_path'],
				'origin'           => $theme['origin'],
				'defaultCodeTheme' => isset( $theme['default_code_theme'] ) ? sanitize_key( $theme['default_code_theme'] ) : 'atom-one-dark',
			);

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

	private function theme( $id, $label, $asset_path, $default_code_theme ) {
		return array(
			'id'                 => $id,
			'label'              => $label,
			'asset_path'         => $asset_path,
			'origin'             => 'owned',
			'class_name'         => 'easymde-markdown-theme-' . $id,
			'default_code_theme' => $default_code_theme,
		);
	}

	private function versioned_asset_url( $asset_path ) {
		return add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( $asset_path ) );
	}
}
