<?php
/**
 * EasyMDE settings page template.
 *
 * @var array<string,mixed> $context Prepared settings page data.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap">
	<h1><?php esc_html_e( 'EasyMDE', 'easymde' ); ?></h1>
	<p><?php esc_html_e( 'EasyMDE adds a scoped split-pane Markdown editor to supported post editing screens.', 'easymde' ); ?></p>
	<?php settings_errors(); ?>

	<table class="widefat striped easymde-settings-summary">
		<tbody>
			<tr>
				<th scope="row"><?php esc_html_e( 'Supported post types', 'easymde' ); ?></th>
				<td><?php echo esc_html( implode( ', ', (array) $context['supported_post_types'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Server renderer', 'easymde' ); ?></th>
				<td>
					<?php
					echo ! empty( $context['has_commonmark'] )
						? esc_html__( 'league/commonmark is active.', 'easymde' )
						: esc_html__( 'league/commonmark is required but unavailable. Install Composer dependencies before rendering or saving EasyMDE Markdown.', 'easymde' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Admin behavior', 'easymde' ); ?></th>
				<td><?php esc_html_e( 'No activation redirect and no unrelated admin-page redirect.', 'easymde' ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Toolbar layout', 'easymde' ); ?></th>
				<td><?php esc_html_e( 'Hybrid icon toolbar', 'easymde' ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Current preset', 'easymde' ); ?></th>
				<td><?php esc_html_e( 'Typora-inspired shortcuts', 'easymde' ); ?></td>
			</tr>
		</tbody>
	</table>

	<form action="options.php" method="post">
		<?php settings_fields( 'easymde_settings' ); ?>
		<input type="hidden" name="<?php echo esc_attr( $context['option_key'] ); ?>[toolbar_layout]" value="hybrid-icons">
		<input type="hidden" name="<?php echo esc_attr( $context['option_key'] ); ?>[version]" value="<?php echo esc_attr( $context['settings_version'] ); ?>">

		<h2><?php esc_html_e( 'Writing settings', 'easymde' ); ?></h2>
		<table class="form-table" role="presentation">
			<tbody>
				<tr>
					<th scope="row"><?php esc_html_e( 'Markdown editor', 'easymde' ); ?></th>
					<td>
						<label for="easymde-spellcheck-enabled">
							<input
								id="easymde-spellcheck-enabled"
								type="checkbox"
								name="<?php echo esc_attr( $context['option_key'] ); ?>[spellcheck_enabled]"
								value="1"
								<?php checked( ! empty( $context['settings']['spellcheck_enabled'] ) ); ?>
							>
							<?php esc_html_e( 'Enable browser spellcheck in the Markdown editor', 'easymde' ); ?>
						</label>
						<p class="description"><?php esc_html_e( 'Uses the browser spellchecker only; saved Markdown and rendered HTML stay unchanged.', 'easymde' ); ?></p>
					</td>
				</tr>
			</tbody>
		</table>

		<h2><?php esc_html_e( 'Shortcut settings', 'easymde' ); ?></h2>
		<p><?php esc_html_e( 'Typora-inspired defaults are active unless overridden below.', 'easymde' ); ?></p>
		<p class="description"><?php esc_html_e( 'Use the current Typora-inspired default by leaving the field blank.', 'easymde' ); ?></p>

		<table class="widefat striped easymde-settings-shortcuts">
			<thead>
				<tr>
					<th scope="col" class="easymde-settings-command-column"><?php esc_html_e( 'Command', 'easymde' ); ?></th>
					<th scope="col" class="easymde-settings-shortcut-column"><?php esc_html_e( 'Windows / Linux', 'easymde' ); ?></th>
					<th scope="col" class="easymde-settings-shortcut-column"><?php esc_html_e( 'macOS', 'easymde' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( (array) $context['commands'] as $easymde_command_id => $easymde_command ) : ?>
					<?php
					$easymde_shortcut    = isset( $context['settings']['shortcuts'][ $easymde_command_id ] ) ? $context['settings']['shortcuts'][ $easymde_command_id ] : array(
						'win' => '',
						'mac' => '',
					);
					$easymde_default_win = isset( $easymde_command['defaultShortcutWin'] ) ? $easymde_command['defaultShortcutWin'] : '';
					$easymde_default_mac = isset( $easymde_command['defaultShortcutMac'] ) ? $easymde_command['defaultShortcutMac'] : '';
					?>
					<tr>
						<th scope="row">
							<label for="easymde-shortcut-<?php echo esc_attr( $easymde_command_id ); ?>-win">
								<?php // phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels. ?>
								<?php echo esc_html( translate( $easymde_command['label'], 'easymde' ) ); ?>
							</label>
						</th>
						<td>
							<input
								id="easymde-shortcut-<?php echo esc_attr( $easymde_command_id ); ?>-win"
								type="text"
								class="regular-text code"
								name="<?php echo esc_attr( $context['option_key'] ); ?>[shortcuts][<?php echo esc_attr( $easymde_command_id ); ?>][win]"
								value="<?php echo esc_attr( $easymde_shortcut['win'] ); ?>"
								placeholder="<?php echo esc_attr( $easymde_default_win ); ?>"
							>
							<?php if ( '' !== $easymde_default_win ) : ?>
								<?php /* translators: %s: default keyboard shortcut. */ ?>
								<p class="description"><?php echo esc_html( sprintf( __( 'Default: %s', 'easymde' ), $easymde_default_win ) ); ?></p>
							<?php endif; ?>
						</td>
						<td>
							<input
								id="easymde-shortcut-<?php echo esc_attr( $easymde_command_id ); ?>-mac"
								type="text"
								class="regular-text code"
								name="<?php echo esc_attr( $context['option_key'] ); ?>[shortcuts][<?php echo esc_attr( $easymde_command_id ); ?>][mac]"
								value="<?php echo esc_attr( $easymde_shortcut['mac'] ); ?>"
								placeholder="<?php echo esc_attr( $easymde_default_mac ); ?>"
							>
							<?php if ( '' !== $easymde_default_mac ) : ?>
								<?php /* translators: %s: default keyboard shortcut. */ ?>
								<p class="description"><?php echo esc_html( sprintf( __( 'Default: %s', 'easymde' ), $easymde_default_mac ) ); ?></p>
							<?php endif; ?>
						</td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>

		<?php submit_button(); ?>
	</form>
</div>
