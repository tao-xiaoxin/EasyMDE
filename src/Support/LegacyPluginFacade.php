<?php

namespace EasyMDE\Support;

use EasyMDE\Plugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class LegacyPluginFacade {

	public static function init() {
		return Plugin::init();
	}

	public static function instance() {
		return Plugin::instance();
	}

	public static function register_toolbar_button( $id, array $config ) {
		Plugin::instance()->register_toolbar_button( $id, $config );
	}

	public static function register_shortcode_helper( $id, array $config ) {
		Plugin::instance()->register_shortcode_helper( $id, $config );
	}
}
