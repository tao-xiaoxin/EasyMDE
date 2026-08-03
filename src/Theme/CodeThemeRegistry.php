<?php

namespace EasyMDE\Theme;

use EasyMDE\Support\Asset;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class CodeThemeRegistry {

	public function all() {
		$themes = array(
			'github'          => $this->theme( 'github', __( 'GitHub', 'easymde' ), 'assets/vendor/highlight/styles/github.min.css', 'vendor' ),
			'github-dark'     => $this->theme( 'github-dark', __( 'GitHub Dark', 'easymde' ), 'assets/vendor/highlight/styles/github-dark.min.css', 'vendor' ),
			'atom-one-dark'   => $this->theme( 'atom-one-dark', __( 'Atom One Dark', 'easymde' ), 'assets/vendor/highlight/styles/atom-one-dark.min.css', 'vendor' ),
			'atom-one-light'  => $this->theme( 'atom-one-light', __( 'Atom One Light', 'easymde' ), 'assets/vendor/highlight/styles/atom-one-light.min.css', 'vendor' ),
			'monokai'         => $this->theme( 'monokai', __( 'Monokai', 'easymde' ), 'assets/vendor/highlight/styles/monokai.min.css', 'vendor' ),
			'vs2015'          => $this->theme( 'vs2015', __( 'VS2015', 'easymde' ), 'assets/vendor/highlight/styles/vs2015.min.css', 'vendor' ),
			'xcode'           => $this->theme( 'xcode', __( 'Xcode', 'easymde' ), 'assets/vendor/highlight/styles/xcode.min.css', 'vendor' ),
			'wechat-inspired' => $this->theme( 'wechat-inspired', __( 'Wechat inspired', 'easymde' ), 'assets/themes/code/wechat-inspired.css', 'owned' ),
			'terminal-noir'   => $this->theme( 'terminal-noir', __( 'Terminal Noir', 'easymde' ), 'assets/themes/code/terminal-noir.css', 'owned' ),
			'fullstack-blue'  => $this->theme( 'fullstack-blue', __( 'Fullstack blue', 'easymde' ), 'assets/themes/code/fullstack-blue.css', 'owned' ),
			'inkwell-code'         => $this->theme( 'inkwell-code', __( '墨砚代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'animal-island-code'   => $this->theme( 'animal-island-code', __( '动物岛代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'phycat-code'          => $this->theme( 'phycat-code', __( 'Phycat 代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'mdmdt-code'           => $this->theme( 'mdmdt-code', __( 'Mdmdt 代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'dogschoice-pink-code' => $this->theme( 'dogschoice-pink-code', __( '狗狗粉代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-petal-code'     => $this->theme( 'bloom-petal-code', __( '花瓣代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-mist-code'      => $this->theme( 'bloom-mist-code', __( '雾蓝代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-verdant-code'   => $this->theme( 'bloom-verdant-code', __( '草木代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-stone-code'     => $this->theme( 'bloom-stone-code', __( '暖石代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-wheat-code'     => $this->theme( 'bloom-wheat-code', __( '麦穗代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-ink-code'       => $this->theme( 'bloom-ink-code', __( '水墨代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-amber-code'     => $this->theme( 'bloom-amber-code', __( '琥珀代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-lapis-code'     => $this->theme( 'bloom-lapis-code', __( '青金代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-ripple-code'    => $this->theme( 'bloom-ripple-code', __( '涟漪代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-cinnabar-code'  => $this->theme( 'bloom-cinnabar-code', __( '丹红代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-sage-code'      => $this->theme( 'bloom-sage-code', __( '鼠尾草代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-spring-code'    => $this->theme( 'bloom-spring-code', __( '紫语代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'spring-code'          => $this->theme( 'spring-code', __( '春日代码', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
		);

		return apply_filters( 'easymde_code_themes', $themes );
	}

	public function get( $id ) {
		$themes = $this->all();
		$id     = $this->sanitize_id( $id );

		return isset( $themes[ $id ] ) ? $themes[ $id ] : $themes['atom-one-dark'];
	}

	public function sanitize_id( $id ) {
		$id     = sanitize_key( (string) $id );
		$themes = $this->all();

		return isset( $themes[ $id ] ) ? $id : 'atom-one-dark';
	}

	public function for_script() {
		$themes = array();
		foreach ( $this->all() as $theme ) {
			$themes[] = array(
				'id'        => $theme['id'],
				'label'     => $theme['label'],
				'cssUrl'    => $this->versioned_asset_url( $theme['asset_path'] ),
				'assetPath' => $theme['asset_path'],
				'origin'    => $theme['origin'],
			);
		}

		return $themes;
	}

	private function theme( $id, $label, $asset_path, $origin ) {
		return array(
			'id'         => $id,
			'label'      => $label,
			'asset_path' => $asset_path,
			'origin'     => $origin,
		);
	}

	private function versioned_asset_url( $asset_path ) {
		return add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( $asset_path ) );
	}
}
