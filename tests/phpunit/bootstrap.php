<?php
/**
 * PHPUnit bootstrap for the WordPress integration test suite.
 */

$_easymde_root = dirname( dirname( __DIR__ ) );
$_tests_dir    = getenv( 'WP_TESTS_DIR' );

if ( ! $_tests_dir ) {
	$_tests_dir = '/tmp/easymde-wordpress-tests-lib';
}

$_functions = rtrim( $_tests_dir, '/\\' ) . '/includes/functions.php';
$_bootstrap = rtrim( $_tests_dir, '/\\' ) . '/includes/bootstrap.php';

if ( ! file_exists( $_functions ) || ! file_exists( $_bootstrap ) ) {
	fwrite(
		STDERR,
		"WordPress test suite not found. Run scripts/install-wp-tests.sh first or set WP_TESTS_DIR.\n"
	);
	exit( 1 );
}

$_polyfills = $_easymde_root . '/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php';
if ( file_exists( $_polyfills ) ) {
	require_once $_polyfills;
}

require_once $_functions;

tests_add_filter(
	'muplugins_loaded',
	function () use ( $_easymde_root ) {
		require $_easymde_root . '/easymde.php';
	}
);

require $_bootstrap;
