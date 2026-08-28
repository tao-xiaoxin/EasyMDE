<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ToolbarRegistry {

	private $toolbar_buttons   = array();
	private $shortcode_helpers = array();

	public function __construct() {
		$this->register_default_toolbar_buttons();
	}

	public function register_toolbar_button( $id, array $config ) {
		$command_id = sanitize_key( $id );
		if ( '' === $command_id ) {
			throw new \RuntimeException( 'easymde-toolbar-command-id-invalid' );
		}

		$command = $this->normalize_command_config( $command_id, $config );
		if ( ! is_string( $command['label'] ) || '' === trim( $command['label'] ) ) {
			throw new \RuntimeException( 'easymde-toolbar-command-label-invalid' );
		}

		$this->assert_shortcut_available( $command_id, $command );
		$this->toolbar_buttons[ $command_id ] = $command;
	}

	public function register_shortcode_helper( $id, array $config ) {
		$this->shortcode_helpers[ sanitize_key( $id ) ] = $config;
	}

	public function get_command_registry() {
		return $this->toolbar_buttons;
	}

	public function get_commands_for_script() {
		$commands = array_values( $this->get_command_registry() );

		foreach ( $commands as &$command ) {
			if ( ! empty( $command['label'] ) && is_string( $command['label'] ) ) {
				// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
				$command['label'] = translate( $command['label'], 'easymde' );
			}

			if ( ! empty( $command['description'] ) && is_string( $command['description'] ) ) {
				// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API descriptions are dynamic extension data seeded from extractable source labels.
				$command['description'] = translate( $command['description'], 'easymde' );
			}
		}

		return $commands;
	}

	public function get_shortcode_helpers_for_script() {
		return array_values( $this->shortcode_helpers );
	}

	private function normalize_command_config( $id, array $config ) {
		$command_id = sanitize_key( $id );

		return array_merge(
			array(
				'id'                 => $command_id,
				'label'              => $command_id,
				'description'        => '',
				'icon'               => 'editor-code',
				'surface'            => 'main',
				'action'             => 'wrap',
				'group'              => 'default',
				'prefix'             => '',
				'suffix'             => '',
				'linePrefix'         => '',
				'defaultShortcutWin' => '',
				'defaultShortcutMac' => '',
			),
			$config,
			array(
				'id' => $command_id,
			)
		);
	}

	private function assert_shortcut_available( $command_id, array $command ) {
		$shortcut_fields = array(
			array(
				'field'  => 'defaultShortcutWin',
				'is_mac' => false,
			),
			array(
				'field'  => 'defaultShortcutMac',
				'is_mac' => true,
			),
		);

		foreach ( $shortcut_fields as $shortcut_field ) {
			$shortcut = $this->canonical_shortcut( $command[ $shortcut_field['field'] ], $shortcut_field['is_mac'] );
			if ( null === $shortcut ) {
				continue;
			}

			foreach ( $this->toolbar_buttons as $existing_id => $existing_command ) {
				if (
					$existing_id === $command_id ||
					ToolbarShortcutCatalog::is_editable_command( $command_id ) ||
					ToolbarShortcutCatalog::is_editable_command( $existing_id )
				) {
					continue;
				}

				$existing_shortcut = $this->canonical_shortcut( $existing_command[ $shortcut_field['field'] ], $shortcut_field['is_mac'] );
				if ( $shortcut === $existing_shortcut ) {
					throw new \RuntimeException( 'easymde-toolbar-shortcut-conflict' );
				}
			}
		}
	}

	private function canonical_shortcut( $value, $is_mac ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return null;
		}

		$parts = explode( '+', $value );
		if ( count( $parts ) < 2 || count( $parts ) > 5 ) {
			return null;
		}

		$key = array_pop( $parts );
		if ( ! $this->is_canonical_shortcut_key( $key ) ) {
			return null;
		}

		$order      = $is_mac ? array( 'Cmd', 'Ctrl', 'Option', 'Shift' ) : array( 'Ctrl', 'Alt', 'Shift', 'Meta' );
		$last_index = -1;
		$has_owner  = false;
		foreach ( $parts as $modifier ) {
			$index = array_search( $modifier, $order, true );
			if ( false === $index || $index <= $last_index ) {
				return null;
			}
			$last_index = $index;
			$has_owner  = $has_owner || 'Shift' !== $modifier;
		}

		return $has_owner ? $value : null;
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

		return is_string( $value ) && (
			1 === preg_match( '/^[A-Z0-9]$/D', $value ) ||
			1 === preg_match( '/^F(?:[1-9]|1[0-2])$/D', $value ) ||
			in_array( $value, $named_keys, true )
		);
	}

	private function source_label( $text ) {
		return $text;
	}

	private function register_default_toolbar_buttons() {
		$this->register_toolbar_button(
			'savepost',
			array(
				'label'              => $this->source_label( 'Save post' ),
				'icon'               => 'saved',
				'surface'            => 'hidden',
				'action'             => 'savePost',
				'group'              => 'system',
				'defaultShortcutWin' => 'Ctrl+S',
				'defaultShortcutMac' => 'Cmd+S',
			)
		);

		$this->register_toolbar_button(
			'bold',
			array(
				'label'              => $this->source_label( 'Bold' ),
				'icon'               => 'editor-bold',
				'surface'            => 'main',
				'action'             => 'wrap',
				'group'              => 'format',
				'prefix'             => '**',
				'suffix'             => '**',
				'defaultShortcutWin' => 'Ctrl+B',
				'defaultShortcutMac' => 'Cmd+B',
			)
		);

		$this->register_toolbar_button(
			'italic',
			array(
				'label'              => $this->source_label( 'Italic' ),
				'icon'               => 'editor-italic',
				'surface'            => 'main',
				'action'             => 'wrap',
				'group'              => 'format',
				'prefix'             => '*',
				'suffix'             => '*',
				'defaultShortcutWin' => 'Ctrl+I',
				'defaultShortcutMac' => 'Cmd+I',
			)
		);

		$this->register_toolbar_button(
			'strike',
			array(
				'label'              => $this->source_label( 'Strikethrough' ),
				'icon'               => 'editor-strikethrough',
				'surface'            => 'main',
				'action'             => 'wrap',
				'group'              => 'format',
				'prefix'             => '~~',
				'suffix'             => '~~',
				'defaultShortcutWin' => 'Alt+Shift+5',
				'defaultShortcutMac' => 'Ctrl+Shift+Backquote',
			)
		);

		$this->register_toolbar_button(
			'paragraph',
			array(
				'label'              => $this->source_label( 'Paragraph' ),
				'icon'               => 'editor-paragraph',
				'surface'            => 'heading-menu',
				'action'             => 'paragraph',
				'group'              => 'heading',
				'defaultShortcutWin' => 'Ctrl+0',
				'defaultShortcutMac' => 'Cmd+0',
			)
		);

		$heading_labels = array(
			1 => $this->source_label( 'Heading 1' ),
			2 => $this->source_label( 'Heading 2' ),
			3 => $this->source_label( 'Heading 3' ),
			4 => $this->source_label( 'Heading 4' ),
			5 => $this->source_label( 'Heading 5' ),
			6 => $this->source_label( 'Heading 6' ),
		);

		for ( $level = 1; $level <= 6; ++$level ) {
			$this->register_toolbar_button(
				'heading' . $level,
				array(
					'label'              => $heading_labels[ $level ],
					'icon'               => 'heading',
					'surface'            => 'heading-menu',
					'action'             => 'heading',
					'group'              => 'heading',
					'level'              => $level,
					'usesLevelLabel'     => true,
					'defaultShortcutWin' => 'Ctrl+' . $level,
					'defaultShortcutMac' => 'Cmd+' . $level,
				)
			);
		}

		$this->register_toolbar_button(
			'quote',
			array(
				'label'              => $this->source_label( 'Quote' ),
				'icon'               => 'format-quote',
				'surface'            => 'main',
				'action'             => 'quote',
				'group'              => 'block',
				'linePrefix'         => '> ',
				'defaultShortcutWin' => 'Ctrl+Shift+Q',
				'defaultShortcutMac' => 'Cmd+Option+Q',
			)
		);

		$this->register_toolbar_button(
			'unorderedlist',
			array(
				'label'              => $this->source_label( 'Unordered list' ),
				'icon'               => 'editor-ul',
				'surface'            => 'main',
				'action'             => 'unorderedList',
				'group'              => 'block',
				'linePrefix'         => '- ',
				'defaultShortcutWin' => 'Ctrl+Shift+BracketRight',
				'defaultShortcutMac' => 'Cmd+Option+U',
			)
		);

		$this->register_toolbar_button(
			'orderedlist',
			array(
				'label'              => $this->source_label( 'Ordered list' ),
				'icon'               => 'editor-ol',
				'surface'            => 'main',
				'action'             => 'orderedList',
				'group'              => 'block',
				'linePrefix'         => '1. ',
				'defaultShortcutWin' => 'Ctrl+Shift+BracketLeft',
				'defaultShortcutMac' => 'Cmd+Option+O',
			)
		);

		$this->register_toolbar_button(
			'inlinecode',
			array(
				'label'              => $this->source_label( 'Inline code' ),
				'icon'               => 'editor-code',
				'surface'            => 'main',
				'action'             => 'wrap',
				'group'              => 'insert',
				'prefix'             => '`',
				'suffix'             => '`',
				'defaultShortcutWin' => 'Ctrl+Shift+Backquote',
				'defaultShortcutMac' => 'Cmd+Shift+Backquote',
			)
		);

		$this->register_toolbar_button(
			'codefence',
			array(
				'label'              => $this->source_label( 'Code fence' ),
				'icon'               => 'media-code',
				'surface'            => 'main',
				'action'             => 'codeFence',
				'group'              => 'insert',
				'defaultShortcutWin' => 'Ctrl+Shift+K',
				'defaultShortcutMac' => 'Cmd+Option+C',
			)
		);

		$this->register_toolbar_button(
			'mathblock',
			array(
				'label'              => $this->source_label( 'Math block' ),
				'icon'               => 'editor-code',
				'surface'            => 'hidden',
				'action'             => 'mathBlock',
				'group'              => 'insert',
				'defaultShortcutWin' => 'Ctrl+Shift+M',
				'defaultShortcutMac' => 'Cmd+Option+B',
			)
		);

		$this->register_toolbar_button(
			'link',
			array(
				'label'              => $this->source_label( 'Link' ),
				'icon'               => 'admin-links',
				'surface'            => 'main',
				'action'             => 'link',
				'group'              => 'insert',
				'defaultShortcutWin' => 'Ctrl+K',
				'defaultShortcutMac' => 'Cmd+K',
			)
		);

		$this->register_toolbar_button(
			'image',
			array(
				'label'              => $this->source_label( 'Image' ),
				'icon'               => 'format-image',
				'surface'            => 'main',
				'action'             => 'image',
				'group'              => 'insert',
				'defaultShortcutWin' => 'Ctrl+Shift+I',
				'defaultShortcutMac' => 'Cmd+Ctrl+I',
			)
		);

		$this->register_toolbar_button(
			'copywechat',
			array(
				'label'              => $this->source_label( 'Copy to WeChat' ),
				'icon'               => 'copy',
				'surface'            => 'main',
				'action'             => 'copyWechat',
				'group'              => 'export',
				'defaultShortcutWin' => 'Ctrl+Shift+W',
				'defaultShortcutMac' => 'Cmd+Ctrl+W',
			)
		);
	}
}
