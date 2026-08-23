<?php
/**
 * EasyMDE settings center React root.
 *
 * @var string $settings_center_brand_mark_url Local brand asset URL.
 * @var string $settings_center_close_url      WordPress Settings URL.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$settings_center_failure_message = __( 'The EasyMDE settings center could not start. WordPress settings remain available.', 'easymde' );
?>
<div class="wrap">
	<div class="easymde-settings-center__notices" aria-live="polite">
		<?php settings_errors(); ?>
	</div>
	<div
		id="easymde-settings-center-root"
		data-failure-message="<?php echo esc_attr( $settings_center_failure_message ); ?>"
		data-loading-message="<?php echo esc_attr__( 'Loading EasyMDE Settings Center...', 'easymde' ); ?>"
	>
		<div
			class="easymde-settings-center-startup"
			data-settings-center-startup
		>
			<div class="easymde-settings-center-startup__brand">
				<img src="<?php echo esc_url( $settings_center_brand_mark_url ); ?>" alt="">
				<strong><?php esc_html_e( 'EasyMDE Settings Center', 'easymde' ); ?></strong>
			</div>
			<div
				class="easymde-settings-center-startup__status"
				data-settings-center-startup-status
				aria-live="polite"
				aria-busy="false"
			></div>
			<a href="<?php echo esc_url( $settings_center_close_url ); ?>">
				<?php esc_html_e( 'Return to WordPress settings', 'easymde' ); ?>
			</a>
			<noscript>
				<p class="easymde-settings-center-startup__noscript" role="alert"><?php echo esc_html( $settings_center_failure_message ); ?></p>
			</noscript>
		</div>
	</div>
</div>
