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
				'cssUrl'    => Asset::url( $theme['asset_path'] ),
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
}
