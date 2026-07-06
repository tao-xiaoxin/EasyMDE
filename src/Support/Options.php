<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Options {

	const EDITOR_SETTINGS         = 'easymde_editor_settings';
	const EDITOR_SETTINGS_VERSION = '0.1.7';

	public function editor_settings_key() {
		return self::EDITOR_SETTINGS;
	}

	public function editor_settings_version() {
		return self::EDITOR_SETTINGS_VERSION;
	}

	public function get_editor_settings() {
		$stored = get_option( self::EDITOR_SETTINGS, array() );

		return is_array( $stored ) ? $stored : array();
	}

	public function is_editor_spellcheck_enabled() {
		$settings = $this->get_editor_settings();

		if ( ! array_key_exists( 'spellcheck_enabled', $settings ) ) {
			return false;
		}

		return $this->is_truthy_setting( $settings['spellcheck_enabled'] );
	}

	private function is_truthy_setting( $value ) {
		if ( true === $value || 1 === $value ) {
			return true;
		}

		if ( is_string( $value ) ) {
			return in_array( strtolower( trim( $value ) ), array( '1', 'true', 'yes', 'on' ), true );
		}

		return false;
	}
}
