<?php
/**
 * EasyMDE settings center React root.
 *
 * @var string $settings_center_close_url   WordPress Settings URL.
 * @var string $settings_center_failure_code Stable startup failure code.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$settings_center_failure_message = __( 'The EasyMDE settings center could not start. WordPress settings remain available.', 'easymde' );
$settings_center_failure_code    = isset( $settings_center_failure_code ) ? $settings_center_failure_code : 'settings-center-bundle-unavailable';
?>
<div class="wrap">
	<div class="easymde-settings-center__notices" aria-live="polite">
		<div class="notice notice-error easymde-settings-center-server-fallback" role="alert" data-settings-center-server-fallback data-error-code="<?php echo esc_attr( $settings_center_failure_code ); ?>">
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
	<div class="easymde-settings-center__notices" aria-live="polite">
		<?php settings_errors(); ?>
	</div>
</div>
