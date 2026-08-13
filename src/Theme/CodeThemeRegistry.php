<?php

namespace EasyMDE\Theme;

use EasyMDE\Support\Asset;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class CodeThemeRegistry {
	private const MAX_THEME_ID_LENGTH = 200;

	public function all() {
		$themes = array(
			'github'               => $this->theme( 'github', __( 'GitHub', 'easymde' ), 'assets/vendor/highlight/styles/github.min.css', 'vendor' ),
			'github-dark'          => $this->theme( 'github-dark', __( 'GitHub Dark', 'easymde' ), 'assets/vendor/highlight/styles/github-dark.min.css', 'vendor' ),
			'atom-one-dark'        => $this->theme( 'atom-one-dark', __( 'Atom One Dark', 'easymde' ), 'assets/vendor/highlight/styles/atom-one-dark.min.css', 'vendor' ),
			'atom-one-light'       => $this->theme( 'atom-one-light', __( 'Atom One Light', 'easymde' ), 'assets/vendor/highlight/styles/atom-one-light.min.css', 'vendor' ),
			'monokai'              => $this->theme( 'monokai', __( 'Monokai', 'easymde' ), 'assets/vendor/highlight/styles/monokai.min.css', 'vendor' ),
			'vs2015'               => $this->theme( 'vs2015', __( 'VS2015', 'easymde' ), 'assets/vendor/highlight/styles/vs2015.min.css', 'vendor' ),
			'xcode'                => $this->theme( 'xcode', __( 'Xcode', 'easymde' ), 'assets/vendor/highlight/styles/xcode.min.css', 'vendor' ),
			'wechat-inspired'      => $this->theme( 'wechat-inspired', __( 'Wechat inspired', 'easymde' ), 'assets/themes/code/wechat-inspired.css', 'owned' ),
			'terminal-noir'        => $this->theme( 'terminal-noir', __( 'Terminal Noir', 'easymde' ), 'assets/themes/code/terminal-noir.css', 'owned' ),
			'fullstack-blue'       => $this->theme( 'fullstack-blue', __( 'Fullstack blue', 'easymde' ), 'assets/themes/code/fullstack-blue.css', 'owned' ),
			'inkwell-code'         => $this->theme( 'inkwell-code', __( 'Inkwell code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'animal-island-code'   => $this->theme( 'animal-island-code', __( 'Animal Island code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'phycat-code'          => $this->theme( 'phycat-code', __( 'Phycat code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'mdmdt-code'           => $this->theme( 'mdmdt-code', __( 'Mdmdt code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'dogschoice-pink-code' => $this->theme( 'dogschoice-pink-code', __( 'Dog\'s Choice Pink code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-petal-code'     => $this->theme( 'bloom-petal-code', __( 'Bloom Petal code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-mist-code'      => $this->theme( 'bloom-mist-code', __( 'Bloom Mist code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-verdant-code'   => $this->theme( 'bloom-verdant-code', __( 'Bloom Verdant code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-stone-code'     => $this->theme( 'bloom-stone-code', __( 'Bloom Stone code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-wheat-code'     => $this->theme( 'bloom-wheat-code', __( 'Bloom Wheat code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-ink-code'       => $this->theme( 'bloom-ink-code', __( 'Bloom Ink code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-amber-code'     => $this->theme( 'bloom-amber-code', __( 'Bloom Amber code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-lapis-code'     => $this->theme( 'bloom-lapis-code', __( 'Bloom Lapis code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-ripple-code'    => $this->theme( 'bloom-ripple-code', __( 'Bloom Ripple code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-cinnabar-code'  => $this->theme( 'bloom-cinnabar-code', __( 'Bloom Cinnabar code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-sage-code'      => $this->theme( 'bloom-sage-code', __( 'Bloom Sage code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'bloom-spring-code'    => $this->theme( 'bloom-spring-code', __( 'Bloom Spring code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
			'spring-code'          => $this->theme( 'spring-code', __( 'Spring code', 'easymde' ), 'assets/themes/code/typora-derived.css', 'owned' ),
		);

		return $this->normalize_filtered_themes(
			apply_filters( 'easymde_code_themes', $themes ),
			$themes
		);
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

	private function normalize_filtered_themes( $filtered_themes, $registered_themes ) {
		if ( ! is_array( $filtered_themes ) ) {
			$this->warn( 'invalid-code-theme-registry' );

			return $registered_themes;
		}

		$normalized_themes = array();
		$required_fields   = array( 'id', 'label', 'asset_path', 'origin' );
		foreach ( $filtered_themes as $key => $theme ) {
			if (
				! is_string( $key )
				|| '' === $key
				|| self::MAX_THEME_ID_LENGTH < strlen( $key )
				|| sanitize_key( $key ) !== $key
			) {
				$key_code = is_string( $key ) ? sanitize_key( $key ) : 'numeric-key';
				if ( is_string( $key ) && self::MAX_THEME_ID_LENGTH < strlen( $key ) ) {
					$key_code = 'too-long-key';
				}
				$this->warn( 'invalid-code-theme-key:' . ( $key_code ? $key_code : 'empty-key' ) );
				continue;
			}

			if ( ! is_array( $theme ) ) {
				$this->warn( 'invalid-code-theme-descriptor:' . $key );
				continue;
			}

			if (
				! isset( $theme['id'] )
				|| ! is_string( $theme['id'] )
				|| '' === $theme['id']
				|| self::MAX_THEME_ID_LENGTH < strlen( $theme['id'] )
				|| sanitize_key( $theme['id'] ) !== $theme['id']
			) {
				$this->warn( 'invalid-code-theme-field:' . $key . ':id' );
				continue;
			}

			$theme_id = $theme['id'];
			if ( isset( $normalized_themes[ $theme_id ] ) ) {
				$this->warn( 'duplicate-code-theme-id:' . $theme_id );
				continue;
			}

			if ( $key !== $theme_id ) {
				$this->warn( 'code-theme-key-id-mismatch:' . $key . ':' . $theme_id );
				continue;
			}

			$valid = true;
			foreach ( $required_fields as $field ) {
				if ( ! isset( $theme[ $field ] ) || ! is_string( $theme[ $field ] ) || '' === trim( $theme[ $field ] ) ) {
					$this->warn( 'invalid-code-theme-field:' . $theme_id . ':' . $field );
					$valid = false;
					break;
				}
			}

			if ( $valid ) {
				$normalized_themes[ $theme_id ] = $theme;
			}
		}

		if ( ! isset( $normalized_themes['atom-one-dark'] ) ) {
			$this->warn( 'code-theme-fallback-restored:atom-one-dark' );
			$normalized_themes = $this->restore_fallback_position(
				$normalized_themes,
				$registered_themes['atom-one-dark']
			);
		}

		return $normalized_themes;
	}

	private function restore_fallback_position( $themes, $fallback ) {
		$fallback_after = null;
		foreach ( $themes as $theme_id => $theme ) {
			if ( 'github' === $theme_id || 'github-dark' === $theme_id ) {
				$fallback_after = $theme_id;
			}
		}

		$restored = array();
		foreach ( $themes as $theme_id => $theme ) {
			$restored[ $theme_id ] = $theme;
			if ( $fallback_after === $theme_id ) {
				$restored['atom-one-dark'] = $fallback;
			}
		}

		if ( ! isset( $restored['atom-one-dark'] ) ) {
			$restored = array( 'atom-one-dark' => $fallback ) + $restored;
		}

		return $restored;
	}

	private function warn( $code ) {
		wp_trigger_error(
			__METHOD__,
			'Code theme registry entry was ignored (' . $code . ').',
			E_USER_WARNING
		);
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
