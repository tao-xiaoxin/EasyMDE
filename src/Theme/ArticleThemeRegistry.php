<?php

namespace EasyMDE\Theme;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ArticleThemeRegistry {

	public function all() {
		$themes = array(
			'default'        => $this->theme( 'default', __( 'Default theme', 'easymde' ), 'assets/themes/article/default.css' ),
			'md2html-normal' => $this->theme( 'md2html-normal', __( 'Markdown2Html default', 'easymde' ), 'assets/themes/article/md2html-normal.css' ),
			'orange-heart'   => $this->theme( 'orange-heart', __( 'Orange heart', 'easymde' ), 'assets/themes/article/orange-heart.css' ),
			'chazi-purple'   => $this->theme( 'chazi-purple', __( 'Chazi purple', 'easymde' ), 'assets/themes/article/chazi-purple.css' ),
			'nenqing-green'  => $this->theme( 'nenqing-green', __( 'Nenqing green', 'easymde' ), 'assets/themes/article/nenqing-green.css' ),
			'green-vitality' => $this->theme( 'green-vitality', __( 'Green vitality', 'easymde' ), 'assets/themes/article/green-vitality.css' ),
			'red-crimson'    => $this->theme( 'red-crimson', __( 'Red crimson', 'easymde' ), 'assets/themes/article/red-crimson.css' ),
			'blue-ying'      => $this->theme( 'blue-ying', __( 'Blue ying', 'easymde' ), 'assets/themes/article/blue-ying.css' ),
			'lanqing'        => $this->theme( 'lanqing', __( 'Lanqing', 'easymde' ), 'assets/themes/article/lanqing.css' ),
			'yamabuki'       => $this->theme( 'yamabuki', __( 'Yamabuki', 'easymde' ), 'assets/themes/article/yamabuki.css' ),
			'grid-black'     => $this->theme( 'grid-black', __( 'Grid black', 'easymde' ), 'assets/themes/article/grid-black.css' ),
			'geek-black'     => $this->theme( 'geek-black', __( 'Geek black', 'easymde' ), 'assets/themes/article/geek-black.css' ),
			'rose-purple'    => $this->theme( 'rose-purple', __( 'Rose purple', 'easymde' ), 'assets/themes/article/rose-purple.css' ),
			'ningye-purple'  => $this->theme( 'ningye-purple', __( 'Ningye purple', 'easymde' ), 'assets/themes/article/ningye-purple.css' ),
			'tech-blue'      => $this->theme( 'tech-blue', __( 'Tech blue', 'easymde' ), 'assets/themes/article/tech-blue.css' ),
			'cute-green'     => $this->theme( 'cute-green', __( 'Cute green', 'easymde' ), 'assets/themes/article/cute-green.css' ),
			'fullstack-blue' => $this->theme( 'fullstack-blue', __( 'Fullstack blue', 'easymde' ), 'assets/themes/article/fullstack-blue.css' ),
			'minimal-black'  => $this->theme( 'minimal-black', __( 'Minimal black', 'easymde' ), 'assets/themes/article/minimal-black.css' ),
			'orange-blue'    => $this->theme( 'orange-blue', __( 'Orange blue', 'easymde' ), 'assets/themes/article/orange-blue.css' ),
			'frontend-peak'  => $this->theme( 'frontend-peak', __( 'Frontend peak', 'easymde' ), 'assets/themes/article/frontend-peak.css' ),
			'cupid-busy'     => $this->theme( 'cupid-busy', __( 'Cupid busy', 'easymde' ), 'assets/themes/article/cupid-busy.css' ),
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
				'id'        => $theme['id'],
				'label'     => $theme['label'],
				'className' => $theme['class_name'],
				'origin'    => $theme['origin'],
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
					'customFont'  => 'orange-heart-inter',
					'windowsFont' => 'orange-heart-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'sans-serif-only',
				);

			case 'red-crimson':
				return array(
					'customFont'  => 'red-crimson-inter',
					'windowsFont' => 'red-crimson-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'sans-serif-only',
				);

			case 'rose-purple':
				return array(
					'customFont'  => 'rose-purple-optima',
					'windowsFont' => 'rose-purple-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'serif-only',
				);

			case 'ningye-purple':
				return array(
					'customFont'  => 'ningye-purple-inter',
					'windowsFont' => 'ningye-purple-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'sans-serif-only',
				);

			case 'cupid-busy':
				return array(
					'customFont'  => 'cupid-busy-inter',
					'windowsFont' => 'cupid-busy-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'sans-serif-only',
				);

			case 'yamabuki':
				return array(
					'customFont'  => 'yamabuki-inter',
					'windowsFont' => 'yamabuki-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'sans-serif-only',
				);

			case 'tech-blue':
				return array(
					'customFont'  => 'tech-blue-optima',
					'windowsFont' => 'tech-blue-microsoft-yahei',
					'appleFont'   => 'pingfang-sc-regular-raw',
					'serifFont'   => 'serif-only',
				);
		}

		return null;
	}

	private function theme( $id, $label, $asset_path ) {
		return array(
			'id'         => $id,
			'label'      => $label,
			'asset_path' => $asset_path,
			'origin'     => 'owned',
			'class_name' => 'easymde-markdown-theme-' . $id,
		);
	}
}
