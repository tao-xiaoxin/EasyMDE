<?php
/**
 * EasyMDE settings center React root.
 *
 * @var string $settings_center_close_url WordPress Settings URL.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$settings_center_failure_message = __( 'The EasyMDE settings center could not start. WordPress settings remain available.', 'easymde' );
?>
<div class="wrap">
	<div class="easymde-settings-center__notices" aria-live="polite">
		<?php settings_errors(); ?>
		<div class="notice notice-error easymde-settings-center-server-fallback" role="alert" data-settings-center-server-fallback>
			<p><?php echo esc_html( $settings_center_failure_message ); ?></p>
			<a href="<?php echo esc_url( $settings_center_close_url ); ?>">
				<?php esc_html_e( 'Return to WordPress settings', 'easymde' ); ?>
			</a>
		</div>
	</div>
	<div
		id="easymde-settings-center-root"
		data-failure-message="<?php echo esc_attr( $settings_center_failure_message ); ?>"
		data-close-url="<?php echo esc_url( $settings_center_close_url ); ?>"
		data-close-label="<?php echo esc_attr__( 'Return to WordPress settings', 'easymde' ); ?>"
	></div>
</div>
