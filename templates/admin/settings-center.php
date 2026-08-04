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
	<form id="easymde-settings-center-form" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>" method="post">
		<?php settings_fields( 'easymde_settings' ); ?>
		<div id="easymde-settings-center-root"></div>
	</form>
</div>
