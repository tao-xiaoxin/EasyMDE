<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Support\Asset;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsPage {

	private $toolbar_registry;
	private $options;

	public function __construct( ToolbarRegistry $toolbar_registry, Options $options ) {
		$this->toolbar_registry = $toolbar_registry;
		$this->options          = $options;
	}

	public function register_hooks() {
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	public function register_admin_menu() {
		add_options_page(
			__( 'EasyMDE', 'easymde' ),
			__( 'EasyMDE', 'easymde' ),
			'manage_options',
			'easymde',
			array( $this, 'render' )
		);
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
		if ( 'settings_page_easymde' !== $hook ) {
			return;
		}

		wp_enqueue_style(
			'easymde-admin-settings',
			Asset::url( 'assets/css/admin/settings.css' ),
			array(),
			EASYMDE_VERSION
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

	public function sanitize_editor_settings( $input ) {
		$input     = is_array( $input ) ? $input : array();
		$current   = $this->get_editor_settings();
		$registry  = $this->toolbar_registry->get_command_registry();
		$sanitized = array(
			'version'        => $this->options->editor_settings_version(),
			'toolbar_layout' => 'hybrid-icons',
			'shortcuts'      => $this->get_default_shortcuts(),
		);
		$errors    = array();
		$seen      = array(
			'win' => array(),
			'mac' => array(),
		);

		$input_shortcuts = isset( $input['shortcuts'] ) && is_array( $input['shortcuts'] ) ? $input['shortcuts'] : array();

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

		return $sanitized;
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
