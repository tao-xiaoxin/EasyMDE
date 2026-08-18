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
	<div id="easymde-settings-center-root"></div>
</div>
