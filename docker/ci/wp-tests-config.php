<?php

define( 'ABSPATH', '/opt/easymde/wordpress/' );
define( 'WP_DEFAULT_THEME', 'default' );
define( 'WP_DEBUG', true );

define( 'DB_NAME', 'easymde_phpunit' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', 'root' );
define( 'DB_HOST', 'easymde-ci-db:3306' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );

define( 'AUTH_KEY', 'easymde-ci-auth-key' );
define( 'SECURE_AUTH_KEY', 'easymde-ci-secure-auth-key' );
define( 'LOGGED_IN_KEY', 'easymde-ci-logged-in-key' );
define( 'NONCE_KEY', 'easymde-ci-nonce-key' );
define( 'AUTH_SALT', 'easymde-ci-auth-salt' );
define( 'SECURE_AUTH_SALT', 'easymde-ci-secure-auth-salt' );
define( 'LOGGED_IN_SALT', 'easymde-ci-logged-in-salt' );
define( 'NONCE_SALT', 'easymde-ci-nonce-salt' );

$table_prefix = 'wptests_';

define( 'WP_TESTS_DOMAIN', 'example.org' );
define( 'WP_TESTS_EMAIL', 'admin@example.org' );
define( 'WP_TESTS_TITLE', 'EasyMDE Test Blog' );
define( 'WP_PHP_BINARY', 'php' );
define( 'WPLANG', '' );
