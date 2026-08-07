<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Support\Asset;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;
use EasyMDE\Support\SettingsCenterRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsPage {

	private $toolbar_registry;
	private $options;
	private $settings_center_repository;
	private $legacy_update_requested = false;
	private $legacy_update_invalid   = false;
	private $legacy_update_expected  = false;
	public function __construct( ToolbarRegistry $toolbar_registry, Options $options, ?SettingsCenterRepository $settings_center_repository = null ) {
		$this->toolbar_registry           = $toolbar_registry;
		$this->options                    = $options;
		$this->settings_center_repository = $settings_center_repository ? $settings_center_repository : new SettingsCenterRepository( $options, $toolbar_registry );
	}

	public function register_hooks() {
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_filter( 'pre_update_option_' . $this->options->editor_settings_key(), array( $this, 'intercept_legacy_settings_update' ), 10, 3 );
	}

	public function register_admin_menu() {
		$settings_page_slug = 'easymde/settings/general';
		add_menu_page(
			__( 'EasyMDE Settings Center', 'easymde' ),
			__( 'EasyMDE', 'easymde' ),
			'manage_options',
			$settings_page_slug,
			array( $this, 'render_settings_center' ),
			Asset::url( 'assets/images/easymde-editor-icon.png' ),
			81
		);
		add_submenu_page(
			$settings_page_slug,
			__( 'EasyMDE Settings Center', 'easymde' ),
			__( 'Settings Center', 'easymde' ),
			'manage_options',
			$settings_page_slug,
			array( $this, 'render_settings_center' )
		);

		$update_capability = $this->get_update_page_capability();
		if ( '' !== $update_capability ) {
			add_submenu_page(
				$settings_page_slug,
				__( 'EasyMDE Updates', 'easymde' ),
				__( 'Updates', 'easymde' ),
				$update_capability,
				'update-core.php'
			);
		}

		add_options_page(
			__( 'EasyMDE', 'easymde' ),
			__( 'EasyMDE', 'easymde' ),
			'manage_options',
			'easymde',
			array( $this, 'render' )
		);
	}

	private function get_update_page_capability() {
		if ( current_user_can( 'update_core' ) ) {
			return 'update_core';
		}

		return current_user_can( 'update_plugins' ) ? 'update_plugins' : '';
	}

	public function register_settings() {
		register_setting(
			'easymde_settings',
			$this->options->editor_settings_key(),
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize_editor_settings' ),
				'default'           => $this->get_editor_settings(),
			)
		);
	}

	public function enqueue_assets( $hook ) {
		if ( current_user_can( 'manage_options' ) ) {
			wp_enqueue_style(
				'easymde-admin-menu',
				Asset::url( 'assets/css/admin/menu.css' ),
				array(),
				$this->get_static_asset_version( 'assets/css/admin/menu.css' )
			);
		}

		if ( 'settings_page_easymde' === $hook ) {
			wp_enqueue_style(
				'easymde-admin-settings',
				Asset::url( 'assets/css/admin/settings.css' ),
				array(),
				EASYMDE_VERSION
			);

			return;
		}

		if ( 'toplevel_page_easymde/settings/general' !== $hook || ! current_user_can( 'manage_options' ) ) {
			return;
		}

		try {
			$asset       = $this->get_settings_center_asset();
			$css_version = $this->get_static_asset_version( 'assets/css/admin/settings-center.css' );
		} catch ( \Throwable $error ) {
			wp_trigger_error(
				__METHOD__,
				'EasyMDE settings center asset contract failed (settings-center-asset-invalid).',
				E_USER_WARNING
			);

			return;
		}

		wp_enqueue_style(
			'easymde-admin-settings-center',
			Asset::url( 'assets/css/admin/settings-center.css' ),
			array(),
			$css_version
		);
		wp_enqueue_script(
			$asset['handle'],
			Asset::url( $asset['path'] ),
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_add_inline_script(
			$asset['handle'],
			'window.EasyMDESettingsCenterBootstrap = ' . wp_json_encode(
				$this->get_settings_center_bootstrap(),
				JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
			) . ';',
			'before'
		);
	}

	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$context = array(
			'has_commonmark'       => MarkdownRenderer::is_available(),
			'settings'             => $this->get_editor_settings(),
			'commands'             => $this->toolbar_registry->get_command_registry(),
			'option_key'           => $this->options->editor_settings_key(),
			'settings_version'     => $this->options->editor_settings_version(),
			'supported_post_types' => apply_filters( 'easymde_supported_post_types', array( 'post', 'page' ) ),
		);

		require EASYMDE_PLUGIN_DIR . 'templates/admin/settings-page.php';
	}

	public function render_settings_center() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		require EASYMDE_PLUGIN_DIR . 'templates/admin/settings-center.php';
	}
	private function get_settings_center_bootstrap() {
		$settings = $this->settings_center_repository->get_settings();

		return array(
			'schemaVersion'   => 2,
			'closeUrl'        => admin_url( 'options-general.php?page=easymde' ),
			'api'             => array(
				'settingsUrl' => rest_url( 'easymde/v1/settings' ),
				'nonce'       => wp_create_nonce( 'wp_rest' ),
				'actionNonce' => wp_create_nonce( 'easymde_update_settings' ),
			),
			'assets'          => array(
				'brandMarkUrl'               => Asset::url( 'assets/images/settings-center/brand-icon-clean.png' ),
				'headerIllustrationUrl'      => Asset::url( 'assets/images/settings-center/header-illustration.png' ),
				'searchEmptyIllustrationUrl' => Asset::url( 'assets/images/settings-center/search-empty-illustration.png' ),
			),
			'links'           => array(
				'projectUrl'       => 'https://github.com/tao-xiaoxin/EasyMDE',
				'documentationUrl' => 'https://github.com/tao-xiaoxin/EasyMDE#readme',
				'releasesUrl'      => 'https://github.com/tao-xiaoxin/EasyMDE/releases',
				'issuesUrl'        => 'https://github.com/tao-xiaoxin/EasyMDE/issues',
				'securityUrl'      => 'https://github.com/tao-xiaoxin/EasyMDE/security/policy',
				'licenseUrl'       => 'https://github.com/tao-xiaoxin/EasyMDE/blob/main/LICENSE',
			),
			'drafts'          => array(
				'images' => array(
					'domain'       => $settings['images']['domain'],
					'backupDomain' => $settings['images']['backupDomain'],
				),
			),
			'defaultSettings' => $this->settings_center_repository->get_default_settings(),
			'settings'        => $settings,
			'strings'         => SettingsCenterStrings::get(),
		);
	}


	private function get_settings_center_asset( $build_dir = '' ) {
		$build_dir     = $build_dir ? trailingslashit( $build_dir ) : Asset::path( 'assets/build/settings-center/' );
		$manifest_path = $build_dir . 'wordpress-manifest.json';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local committed build manifest, never a remote URL.
		$manifest_json = is_readable( $manifest_path ) ? file_get_contents( $manifest_path ) : false;
		$manifest      = false === $manifest_json ? null : json_decode( $manifest_json, true );
		$entry_key     = 'frontend/src/entrypoints/settings-center.tsx';

		if (
			! is_array( $manifest )
			|| 1 !== ( $manifest['schemaVersion'] ?? null )
			|| ! isset( $manifest['entries'] )
			|| ! is_array( $manifest['entries'] )
			|| array( $entry_key ) !== array_keys( $manifest['entries'] )
			|| ! is_array( $manifest['entries'][ $entry_key ] )
		) {
			throw new \RuntimeException( 'settings-center-manifest-invalid' );
		}

		$entry = $manifest['entries'][ $entry_key ];
		$file  = isset( $entry['file'] ) ? (string) $entry['file'] : '';
		$asset = isset( $entry['asset'] ) ? (string) $entry['asset'] : '';
		if (
			'easymde-admin-settings-center' !== ( $entry['handle'] ?? null )
			|| array( 'wp-element' ) !== ( $entry['dependencies'] ?? null )
			|| array() !== ( $entry['resources'] ?? null )
			|| ! preg_match( '#^assets/settings-center-[A-Za-z0-9_-]+\.js$#', $file )
			|| preg_replace( '/\.js$/', '.asset.php', $file ) !== $asset
		) {
			throw new \RuntimeException( 'settings-center-manifest-invalid' );
		}

		$script_path   = $build_dir . $file;
		$metadata_path = $build_dir . $asset;
		if ( ! is_file( $script_path ) || ! is_readable( $metadata_path ) ) {
			throw new \RuntimeException( 'settings-center-build-missing' );
		}

		$metadata = require $metadata_path;
		if (
			! is_array( $metadata )
			|| array( 'wp-element' ) !== ( $metadata['dependencies'] ?? null )
			|| ! isset( $metadata['version'] )
			|| ! preg_match( '/^[a-f0-9]{16}$/', (string) $metadata['version'] )
		) {
			throw new \RuntimeException( 'settings-center-metadata-invalid' );
		}

		$script_hash = hash_file( 'sha256', $script_path );
		if (
			false === $script_hash
			|| ! hash_equals( (string) $metadata['version'], substr( $script_hash, 0, 16 ) )
		) {
			throw new \RuntimeException( 'settings-center-build-integrity-invalid' );
		}

		return array(
			'handle'       => 'easymde-admin-settings-center',
			'path'         => 'assets/build/settings-center/' . $file,
			'dependencies' => $metadata['dependencies'],
			'version'      => (string) $metadata['version'],
		);
	}

	private function get_static_asset_version( $asset_path ) {
		$path = Asset::path( $asset_path );
		if ( ! is_readable( $path ) ) {
			throw new \RuntimeException( 'settings-center-static-asset-unreadable' );
		}

		$hash = hash_file( 'sha256', $path );
		if ( ! is_string( $hash ) || ! preg_match( '/^[a-f0-9]{64}$/', $hash ) ) {
			throw new \RuntimeException( 'settings-center-static-asset-version-invalid' );
		}

		return substr( $hash, 0, 16 );
	}

	public function sanitize_editor_settings( $input ) {
		$input                         = is_array( $input ) ? $input : array();
		$this->legacy_update_requested = true;
		$this->legacy_update_invalid   = false;
		$this->legacy_update_expected  = $this->options->get_editor_settings_snapshot();
		if ( null === $this->legacy_update_expected ) {
			$this->legacy_update_invalid = true;
			return $this->get_editor_settings();
		}
		$stored    = is_array( $this->legacy_update_expected ) ? $this->legacy_update_expected : array();
		$current   = $this->get_editor_settings();
		$registry  = $this->toolbar_registry->get_command_registry();
		$sanitized = array(
			'version'        => $this->options->editor_settings_version(),
			'toolbar_layout' => 'hybrid-icons',
			'shortcuts'      => $this->get_default_shortcuts(),
		);
		if ( isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] ) ) {
			$current['settings_center']   = $stored['settings_center'];
			$sanitized['settings_center'] = $stored['settings_center'];
		}
		if ( array_key_exists( 'settings_center_revision', $stored ) ) {
			$revision                              = is_numeric( $stored['settings_center_revision'] ) ? max( 0, absint( $stored['settings_center_revision'] ) ) : 0;
			$current['settings_center_revision']   = $revision;
			$sanitized['settings_center_revision'] = $revision;
		}
		$errors                   = array();
		$seen                     = array(
			'win' => array(),
			'mac' => array(),
		);
		$has_input_shortcuts      = isset( $input['shortcuts'] ) && is_array( $input['shortcuts'] );
		$input_shortcuts          = $has_input_shortcuts ? $input['shortcuts'] : array();
		$legacy_shortcuts_to_sync = array();
		foreach ( $registry as $command_id => $command ) {
			foreach ( array( 'win', 'mac' ) as $platform ) {
				$raw_value = '';
				if ( isset( $input_shortcuts[ $command_id ][ $platform ] ) ) {
					$raw_value = trim( (string) $input_shortcuts[ $command_id ][ $platform ] );
				}

				if ( '' === $raw_value ) {
					$raw_value = isset( $sanitized['shortcuts'][ $command_id ][ $platform ] ) ? $sanitized['shortcuts'][ $command_id ][ $platform ] : '';
				}

				$normalized = $this->normalize_shortcut_value( $raw_value, $platform );
				if ( false === $normalized ) {
					$errors[] = sprintf(
						/* translators: 1: toolbar command label, 2: platform label. */
						__( 'Invalid shortcut value for %1$s (%2$s). Use combinations like Ctrl+B or Command+Option+C.', 'easymde' ),
						// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
						translate( $command['label'], 'easymde' ),
						$this->get_platform_label( $platform )
					);
					continue;
				}

				$sanitized['shortcuts'][ $command_id ][ $platform ] = $normalized;
				if ( isset( $input_shortcuts[ $command_id ] ) && is_array( $input_shortcuts[ $command_id ] ) && array_key_exists( $platform, $input_shortcuts[ $command_id ] ) ) {
					$legacy_shortcuts_to_sync[ $command_id ][ $platform ] = $normalized;
				}

				if ( '' !== $normalized ) {
					if ( isset( $seen[ $platform ][ $normalized ] ) ) {
						$errors[] = sprintf(
							/* translators: 1: first toolbar command label, 2: second toolbar command label, 3: shortcut, 4: platform label. */
							__( 'Shortcut conflict: %1$s and %2$s both use %3$s on %4$s.', 'easymde' ),
							$seen[ $platform ][ $normalized ],
							// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
							translate( $command['label'], 'easymde' ),
							$normalized,
							$this->get_platform_label( $platform )
						);
						continue;
					}

					// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
					$seen[ $platform ][ $normalized ] = translate( $command['label'], 'easymde' );
				}
			}
		}

		if ( ! empty( $errors ) ) {
			$this->legacy_update_invalid = true;
			foreach ( $errors as $index => $message ) {
				add_settings_error(
					$this->options->editor_settings_key(),
					'easymde_shortcut_error_' . $index,
					$message,
					'error'
				);
			}

			return $current;
		}

		if ( ! empty( $legacy_shortcuts_to_sync ) && isset( $sanitized['settings_center'] ) && is_array( $sanitized['settings_center'] ) ) {
			$sanitized['settings_center']          = $this->settings_center_repository->sync_legacy_shortcuts(
				$sanitized['settings_center'],
				$legacy_shortcuts_to_sync
			);
			$current_revision                      = isset( $stored['settings_center_revision'] ) && is_numeric( $stored['settings_center_revision'] )
				? max( 0, absint( $stored['settings_center_revision'] ) )
				: 0;
			$sanitized['settings_center_revision'] = $current_revision + 1;
		}

		return $sanitized;
	}

	/**
	 * Settings API still owns its legacy form, but never writes the canonical
	 * option directly. The repository commits its shortcut delta atomically.
	 */
	public function intercept_legacy_settings_update( $value, $old_value, $option ) {
		unset( $option );
		if ( ! $this->legacy_update_requested ) {
			return $value;
		}

		$this->legacy_update_requested = false;
		if ( $this->legacy_update_invalid || ! is_array( $value ) ) {
			return $old_value;
		}

		$input_shortcuts = isset( $value['shortcuts'] ) && is_array( $value['shortcuts'] )
			? $value['shortcuts']
			: array();
		$result          = $this->settings_center_repository->update_legacy_shortcuts(
			$input_shortcuts,
			$this->legacy_update_expected
		);
		if ( is_wp_error( $result ) ) {
			add_settings_error(
				$this->options->editor_settings_key(),
				$result->get_error_code(),
				$result->get_error_message(),
				'error'
			);
		}

		// Prevent the outer Settings API update_option() write after the repository CAS.
		return $old_value;
	}

	public function get_editor_settings() {
		$defaults = array(
			'version'        => $this->options->editor_settings_version(),
			'toolbar_layout' => 'hybrid-icons',
			'shortcuts'      => $this->get_default_shortcuts(),
		);
		$stored   = $this->options->get_editor_settings();
		if ( ! is_array( $stored ) ) {
			return $defaults;
		}

		$settings = $defaults;

		if ( ! empty( $stored['version'] ) && is_string( $stored['version'] ) ) {
			$settings['version'] = sanitize_text_field( $stored['version'] );
		}

		if ( ! empty( $stored['toolbar_layout'] ) && 'hybrid-icons' === $stored['toolbar_layout'] ) {
			$settings['toolbar_layout'] = 'hybrid-icons';
		}

		if ( ! empty( $stored['shortcuts'] ) && is_array( $stored['shortcuts'] ) ) {
			foreach ( $this->toolbar_registry->get_command_registry() as $command_id => $command ) {
				unset( $command );
				foreach ( array( 'win', 'mac' ) as $platform ) {
					if ( ! isset( $stored['shortcuts'][ $command_id ][ $platform ] ) ) {
						continue;
					}

					$normalized = $this->normalize_shortcut_value( $stored['shortcuts'][ $command_id ][ $platform ], $platform );
					if ( false !== $normalized && '' !== $normalized ) {
						$settings['shortcuts'][ $command_id ][ $platform ] = $normalized;
					}
				}
			}
		}

		return $settings;
	}

	public function get_shortcut_config_for_script() {
		$settings  = $this->get_editor_settings();
		$registry  = $this->toolbar_registry->get_command_registry();
		$shortcuts = array();

		foreach ( $registry as $command_id => $command ) {
			unset( $command );
			$shortcuts[ $command_id ] = array(
				'win' => isset( $settings['shortcuts'][ $command_id ]['win'] ) ? $settings['shortcuts'][ $command_id ]['win'] : '',
				'mac' => isset( $settings['shortcuts'][ $command_id ]['mac'] ) ? $settings['shortcuts'][ $command_id ]['mac'] : '',
			);
		}

		return $shortcuts;
	}

	private function get_default_shortcuts() {
		$shortcuts = array();

		foreach ( $this->toolbar_registry->get_command_registry() as $command_id => $command ) {
			$shortcuts[ $command_id ] = array(
				'win' => isset( $command['defaultShortcutWin'] ) ? (string) $command['defaultShortcutWin'] : '',
				'mac' => isset( $command['defaultShortcutMac'] ) ? (string) $command['defaultShortcutMac'] : '',
			);
		}

		return $shortcuts;
	}

	private function get_platform_label( $platform ) {
		return 'mac' === $platform ? __( 'macOS', 'easymde' ) : __( 'Windows / Linux', 'easymde' );
	}

	private function normalize_shortcut_value( $value, $platform ) {
		$value = trim( (string) $value );
		if ( '' === $value ) {
			return '';
		}

		$parts = preg_split( '/\s*\+\s*/', $value );
		if ( ! $parts || count( $parts ) < 2 ) {
			return false;
		}

		$modifiers = array();
		$key       = '';
		foreach ( $parts as $part ) {
			if ( '' === $part ) {
				return false;
			}

			$modifier = $this->normalize_shortcut_modifier( $part, $platform );
			if ( '' !== $modifier ) {
				if ( isset( $modifiers[ $modifier ] ) ) {
					return false;
				}

				$modifiers[ $modifier ] = true;
				continue;
			}

			$normalized_key = $this->normalize_shortcut_key( $part );
			if ( '' === $normalized_key || '' !== $key ) {
				return false;
			}

			$key = $normalized_key;
		}

		if ( '' === $key || empty( $modifiers ) ) {
			return false;
		}

		$order = 'mac' === $platform
			? array( 'Cmd', 'Ctrl', 'Option', 'Shift' )
			: array( 'Ctrl', 'Alt', 'Shift', 'Meta' );

		$normalized_parts = array();
		foreach ( $order as $modifier ) {
			if ( isset( $modifiers[ $modifier ] ) ) {
				$normalized_parts[] = $modifier;
			}
		}

		$normalized_parts[] = $key;

		return implode( '+', $normalized_parts );
	}

	private function normalize_shortcut_modifier( $modifier, $platform ) {
		$modifier = strtolower( trim( (string) $modifier ) );
		if ( '' === $modifier ) {
			return '';
		}

		if ( in_array( $modifier, array( 'mod', 'cmd', 'command', 'meta', 'super', 'win' ), true ) ) {
			return 'mac' === $platform ? 'Cmd' : ( 'mod' === $modifier ? 'Ctrl' : 'Meta' );
		}

		if ( in_array( $modifier, array( 'ctrl', 'control', 'ctl' ), true ) ) {
			return 'Ctrl';
		}

		if ( in_array( $modifier, array( 'alt', 'option', 'opt' ), true ) ) {
			return 'mac' === $platform ? 'Option' : 'Alt';
		}

		if ( 'shift' === $modifier ) {
			return 'Shift';
		}

		return '';
	}

	private function normalize_shortcut_key( $key ) {
		$key = trim( (string) $key );
		if ( '' === $key ) {
			return '';
		}

		$lower        = strtolower( $key );
		$special_keys = array(
			'tab'        => 'Tab',
			'enter'      => 'Enter',
			'return'     => 'Enter',
			'space'      => 'Space',
			'spacebar'   => 'Space',
			'escape'     => 'Escape',
			'esc'        => 'Escape',
			'backspace'  => 'Backspace',
			'delete'     => 'Delete',
			'del'        => 'Delete',
			'up'         => 'Up',
			'arrowup'    => 'Up',
			'down'       => 'Down',
			'arrowdown'  => 'Down',
			'left'       => 'Left',
			'arrowleft'  => 'Left',
			'right'      => 'Right',
			'arrowright' => 'Right',
			'home'       => 'Home',
			'end'        => 'End',
			'pageup'     => 'PageUp',
			'pagedown'   => 'PageDown',
		);

		if ( isset( $special_keys[ $lower ] ) ) {
			return $special_keys[ $lower ];
		}

		if ( preg_match( '/^f([1-9]|1[0-2])$/i', $key ) ) {
			return strtoupper( $key );
		}

		if ( 1 === strlen( $key ) ) {
			if ( preg_match( '/[a-z]/i', $key ) ) {
				return strtoupper( $key );
			}

			if ( preg_match( '/[0-9\[\]`\\\\\\/\\.,\\-=]/', $key ) ) {
				return $key;
			}
		}

		return '';
	}
}
