<?php

namespace EasyMDE\Support;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsCenterShortcuts {

	private $toolbar_registry;

	public function __construct( ToolbarRegistry $toolbar_registry ) {
		$this->toolbar_registry = $toolbar_registry;
	}

	public function get_default_values() {
		$shortcuts = array();
		foreach ( $this->toolbar_registry->get_command_registry() as $command_id => $command ) {
			$center_id = $this->center_shortcut_id( $command_id );
			if ( ! $center_id ) {
				continue;
			}

			$shortcuts[ $center_id ] = array(
				'windows' => $this->validated_registry_shortcut( $command, 'defaultShortcutWin', false ),
				'mac'     => $this->validated_registry_shortcut( $command, 'defaultShortcutMac', true ),
			);
		}

		return $shortcuts;
	}

	public function get_shortcut_config_for_script( array $shortcut_values ) {
		$registry  = $this->toolbar_registry->get_command_registry();
		$shortcuts = array();

		foreach ( $registry as $command_id => $command ) {
			$center_id = $this->center_shortcut_id( $command_id );
			if ( $center_id && isset( $shortcut_values[ $center_id ] ) ) {
				$shortcuts[ $command_id ] = array(
					'win' => $shortcut_values[ $center_id ]['windows'],
					'mac' => $shortcut_values[ $center_id ]['mac'],
				);
				continue;
			}

			$shortcuts[ $command_id ] = array(
				'win' => $this->validated_registry_shortcut( $command, 'defaultShortcutWin', false ),
				'mac' => $this->validated_registry_shortcut( $command, 'defaultShortcutMac', true ),
			);
		}

		return $shortcuts;
	}

	public function get_reserved_shortcuts_for_script() {
		$reserved = array();

		foreach ( $this->toolbar_registry->get_commands_for_script() as $command ) {
			$command_id = isset( $command['id'] ) ? (string) $command['id'] : '';
			$windows    = $this->validated_registry_shortcut( $command, 'defaultShortcutWin', false );
			$mac        = $this->validated_registry_shortcut( $command, 'defaultShortcutMac', true );
			if ( $this->center_shortcut_id( $command_id ) || ( '' === $windows && '' === $mac ) ) {
				continue;
			}

			$reserved[] = array(
				'id'      => $command_id,
				'label'   => isset( $command['label'] ) ? (string) $command['label'] : $command_id,
				'windows' => $windows,
				'mac'     => $mac,
			);
		}

		return $reserved;
	}

	public function sanitize_shortcut_values( array $shortcut_values ) {
		foreach ( $shortcut_values as $shortcut_id => $shortcut ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$normalized = $this->normalize_shortcut( $shortcut[ $platform ], 'mac' === $platform );
				if ( false === $normalized ) {
					return new WP_Error(
						'easymde_settings_invalid_shortcut',
						__( 'One or more shortcut values are invalid.', 'easymde' ),
						array( 'status' => 400 )
					);
				}
				$shortcut_values[ $shortcut_id ][ $platform ] = $normalized;
			}
		}

		$shortcut_conflict = $this->find_shortcut_conflict( $shortcut_values );
		if ( $shortcut_conflict ) {
			return new WP_Error(
				'easymde_settings_shortcut_conflict',
				__( 'One or more shortcut values conflict.', 'easymde' ),
				array(
					'status'   => 409,
					'platform' => $shortcut_conflict['platform'],
					'shortcut' => $shortcut_conflict['shortcut'],
					'bindings' => $shortcut_conflict['bindings'],
				)
			);
		}

		return $shortcut_values;
	}

	private function normalize_shortcut( $value, $is_mac ) {
		if ( ! is_string( $value ) ) {
			return false;
		}
		if ( '' === $value ) {
			return '';
		}
		$parts = explode( '+', $value );
		if ( count( $parts ) < 2 || count( $parts ) > 5 ) {
			return false;
		}
		$key = array_pop( $parts );
		if ( ! $this->is_canonical_shortcut_key( $key ) ) {
			return false;
		}

		$order      = $is_mac ? array( 'Cmd', 'Ctrl', 'Option', 'Shift' ) : array( 'Ctrl', 'Alt', 'Shift', 'Meta' );
		$last_index = -1;
		$has_owner  = false;
		foreach ( $parts as $modifier ) {
			$index = array_search( $modifier, $order, true );
			if ( false === $index || $index <= $last_index ) {
				return false;
			}
			$last_index = $index;
			$has_owner  = $has_owner || 'Shift' !== $modifier;
		}

		return $has_owner ? $value : false;
	}

	private function is_canonical_shortcut_key( $value ) {
		$named_keys = array(
			'Space',
			'Enter',
			'Backspace',
			'Delete',
			'Insert',
			'Home',
			'End',
			'PageUp',
			'PageDown',
			'ArrowUp',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'Backquote',
			'Minus',
			'Equal',
			'BracketLeft',
			'BracketRight',
			'Backslash',
			'Semicolon',
			'Quote',
			'Comma',
			'Period',
			'Slash',
		);

		return 1 === preg_match( '/^[A-Z0-9]$/D', $value )
			|| 1 === preg_match( '/^F(?:[1-9]|1[0-2])$/D', $value )
			|| in_array( $value, $named_keys, true );
	}

	private function validated_registry_shortcut( array $command, $field, $is_mac ) {
		$value = array_key_exists( $field, $command ) ? $command[ $field ] : '';
		if ( false === $this->normalize_shortcut( $value, $is_mac ) ) {
			throw new \RuntimeException( 'easymde-toolbar-shortcut-invalid' );
		}

		return $value;
	}

	private function find_shortcut_conflict( array $shortcut_values ) {
		$owners = array(
			'windows' => array(),
			'mac'     => array(),
		);

		foreach ( $this->get_reserved_shortcuts_for_script() as $reserved ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$shortcut = $reserved[ $platform ];
				if ( '' === $shortcut ) {
					continue;
				}
				$binding = array(
					'id'       => $reserved['id'],
					'label'    => $reserved['label'],
					'editable' => false,
				);
				if ( isset( $owners[ $platform ][ $shortcut ] ) ) {
					if ( ! $owners[ $platform ][ $shortcut ]['editable'] && ! $binding['editable'] ) {
						continue;
					}
					return array(
						'platform' => $platform,
						'shortcut' => $shortcut,
						'bindings' => array( $owners[ $platform ][ $shortcut ], $binding ),
					);
				}
				$owners[ $platform ][ $shortcut ] = $binding;
			}
		}

		$editable_labels = $this->get_editable_shortcut_labels_for_script();
		foreach ( $shortcut_values as $shortcut_id => $shortcut ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$value = $shortcut[ $platform ];
				if ( '' === $value ) {
					continue;
				}
				$binding = array(
					'id'       => $shortcut_id,
					'label'    => isset( $editable_labels[ $shortcut_id ] ) ? $editable_labels[ $shortcut_id ] : $shortcut_id,
					'editable' => true,
				);
				if ( isset( $owners[ $platform ][ $value ] ) ) {
					return array(
						'platform' => $platform,
						'shortcut' => $value,
						'bindings' => array( $owners[ $platform ][ $value ], $binding ),
					);
				}
				$owners[ $platform ][ $value ] = $binding;
			}
		}

		return false;
	}

	private function get_editable_shortcut_labels_for_script() {
		$labels = array();
		foreach ( $this->toolbar_registry->get_commands_for_script() as $command ) {
			$command_id = isset( $command['id'] ) ? (string) $command['id'] : '';
			$center_id  = $this->center_shortcut_id( $command_id );
			if ( ! $center_id ) {
				continue;
			}
			$labels[ $center_id ] = isset( $command['label'] ) ? (string) $command['label'] : $center_id;
		}

		return $labels;
	}

	private function center_shortcut_id( $command_id ) {
		return ToolbarShortcutCatalog::settings_id_for_command( $command_id );
	}
}
