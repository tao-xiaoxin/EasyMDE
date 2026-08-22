<?php
/**
 * EasyMDE settings center React root.
 *
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap">
	<div class="easymde-settings-center__notices" aria-live="polite">
		<?php settings_errors(); ?>
	</div>
	<div
		id="easymde-settings-center-root"
		data-failure-message="<?php echo esc_attr__( 'The EasyMDE settings center could not start. WordPress settings remain available.', 'easymde' ); ?>"
	></div>
</div>
