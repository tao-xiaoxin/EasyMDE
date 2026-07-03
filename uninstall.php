<?php
/**
 * EasyMDE uninstall hook.
 *
 * The plugin keeps post meta and user CSS data unless a future explicit data
 * removal flow is added.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
