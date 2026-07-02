<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Asset {

	public static function url( $path ) {
		return EASYMDE_PLUGIN_URL . ltrim( (string) $path, '/' );
	}

	public static function path( $path ) {
		return EASYMDE_PLUGIN_DIR . ltrim( (string) $path, '/' );
	}
}
