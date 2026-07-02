<?php

function easymde_verify_i18n_fail( $message ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- CLI verification script writes failure details to STDERR.
	fwrite( STDERR, $message . PHP_EOL );
	exit( 1 );
}

function easymde_verify_i18n_unload_for_reload( $domain ) {
	static $supports_reloadable = null;

	if ( null === $supports_reloadable ) {
		$function            = new ReflectionFunction( 'unload_textdomain' );
		$supports_reloadable = $function->getNumberOfParameters() >= 2;
	}

	if ( $supports_reloadable ) {
		unload_textdomain( $domain, true );
		return;
	}

	unload_textdomain( $domain );
}

if ( ! defined( 'ABSPATH' ) ) {
	easymde_verify_i18n_fail( 'WordPress is not loaded.' );
}

if ( ! did_action( 'init' ) ) {
	easymde_verify_i18n_fail( 'EasyMDE i18n verification must run after WordPress init.' );
}

if ( false !== has_action( 'plugins_loaded', array( 'EasyMDE_Plugin', 'init' ) ) ) {
	easymde_verify_i18n_fail( 'EasyMDE must not initialize on plugins_loaded.' );
}

if ( false === has_action( 'init', array( 'EasyMDE_Plugin', 'init' ) ) ) {
	easymde_verify_i18n_fail( 'EasyMDE init hook is not registered on init.' );
}

if ( class_exists( 'EasyMDE\Support\LegacyTranslations', false ) ) {
	easymde_verify_i18n_fail( 'LegacyTranslations is loaded.' );
}

if ( has_filter( 'gettext_easymde' ) ) {
	easymde_verify_i18n_fail( 'gettext_easymde filter is registered.' );
}

$zh_cn_locale = function () {
	return 'zh_CN';
};

add_filter( 'locale', $zh_cn_locale, 999 );
add_filter( 'determine_locale', $zh_cn_locale, 999 );
easymde_verify_i18n_unload_for_reload( 'easymde' );

$translated = __( 'Shortcut settings', 'easymde' );
if ( '快捷键设置' !== $translated ) {
	easymde_verify_i18n_fail( 'Bundled zh_CN MO did not translate "Shortcut settings"; got: ' . $translated );
}

if ( ! is_textdomain_loaded( 'easymde' ) ) {
	easymde_verify_i18n_fail( 'The easymde text domain was not loaded by WordPress.' );
}

remove_filter( 'locale', $zh_cn_locale, 999 );
remove_filter( 'determine_locale', $zh_cn_locale, 999 );
easymde_verify_i18n_unload_for_reload( 'easymde' );

$en_us_locale = function () {
	return 'en_US';
};

add_filter( 'locale', $en_us_locale, 999 );
add_filter( 'determine_locale', $en_us_locale, 999 );

$english = __( 'Shortcut settings', 'easymde' );
if ( 'Shortcut settings' !== $english ) {
	easymde_verify_i18n_fail( 'en_US unexpectedly received a translated EasyMDE string; got: ' . $english );
}

remove_filter( 'locale', $en_us_locale, 999 );
remove_filter( 'determine_locale', $en_us_locale, 999 );
easymde_verify_i18n_unload_for_reload( 'easymde' );

// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- CLI verification script writes success details to STDOUT.
fwrite( STDOUT, 'EasyMDE WordPress i18n runtime verification passed.' . PHP_EOL );
