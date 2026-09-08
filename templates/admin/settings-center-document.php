<?php
/**
 * Dedicated EasyMDE Settings Center document.
 *
 * @var bool   $settings_center_assets_ready Whether the local settings assets are valid.
 * @var string $settings_center_close_url   Same-origin URL back to WordPress settings.
 * @var string $settings_center_favicon_url Favicon URL for this document.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php echo esc_attr( get_option( 'blog_charset' ) ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title><?php esc_html_e( 'EasyMDE Settings Center', 'easymde' ); ?></title>
		<link rel="icon" type="image/png" href="<?php echo esc_url( $settings_center_favicon_url ); ?>" data-easymde-settings-favicon="true">
		<?php if ( $settings_center_assets_ready ) : ?>
			<?php wp_styles()->do_items( array( 'easymde-admin-message-alert', 'easymde-admin-settings-center' ) ); ?>
			<?php wp_scripts()->do_items( array( 'easymde-admin-settings-center' ) ); ?>
		<?php endif; ?>
</head>
<body class="easymde-settings-center-document">
	<?php require EASYMDE_PLUGIN_DIR . 'templates/admin/settings-center.php'; ?>
</body>
</html>
