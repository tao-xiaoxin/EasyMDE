<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Options {

	const EDITOR_SETTINGS         = 'easymde_editor_settings';
	const EDITOR_SETTINGS_VERSION = '0.1.8';

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
}
