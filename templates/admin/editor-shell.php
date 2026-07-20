<?php
/**
 * EasyMDE editor shell template.
 *
 * @var array<string,mixed> $context Prepared editor data.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$easymde_editor_post                 = $context['post'];
$easymde_theme_state                 = $context['theme_state'];
$easymde_markdown_fingerprint        = isset( $context['markdown_fingerprint'] ) ? (string) $context['markdown_fingerprint'] : '';
$easymde_initial_preview_ready       = ! empty( $context['initial_preview_ready'] ) ? '1' : '0';
$easymde_initial_preview_pending     = ! empty( $context['initial_preview_pending'] );
$easymde_initial_preview_provisional = ! empty( $context['initial_preview_provisional'] ) ? '1' : '0';
$easymde_initial_preview_features    = wp_json_encode( ! empty( $context['initial_preview_features'] ) ? $context['initial_preview_features'] : array() );
$easymde_preview_refreshing          = $easymde_initial_preview_pending ? '1' : '0';
$easymde_preview_busy                = $easymde_initial_preview_pending ? 'true' : 'false';
$easymde_initial_pending_status      = '<p class="easymde-preview-pending" role="status">' . esc_html__( 'Rendering preview...', 'easymde' ) . '</p>';
$easymde_initial_preview             = $context['initial_preview'];

if ( $easymde_initial_preview_pending ) {
	$easymde_initial_preview = '1' === $easymde_initial_preview_provisional && '' !== trim( (string) $context['initial_preview'] )
		? $context['initial_preview'] . "\n" . $easymde_initial_pending_status
		: $easymde_initial_pending_status;
}
?>
<div id="easymde-editor" class="easymde-editor" data-post-id="<?php echo esc_attr( $easymde_editor_post->ID ); ?>" data-easymde-markdown-fingerprint="<?php echo esc_attr( $easymde_markdown_fingerprint ); ?>">
	<input type="hidden" id="easymde-enabled-field" name="easymde_enabled" value="1">
	<input type="hidden" id="easymde-markdown-theme-field" name="easymde_markdown_theme" value="<?php echo esc_attr( $easymde_theme_state['markdownTheme'] ); ?>">
	<input type="hidden" id="easymde-code-theme-field" name="easymde_code_theme" value="<?php echo esc_attr( $easymde_theme_state['codeTheme'] ); ?>">
	<input type="hidden" id="easymde-custom-css-id-field" name="easymde_custom_css_id" value="<?php echo esc_attr( $easymde_theme_state['customCssId'] ); ?>">
	<input type="hidden" id="easymde-custom-font-field" name="easymde_custom_font" value="<?php echo esc_attr( $easymde_theme_state['customFont'] ); ?>">
	<input type="hidden" id="easymde-windows-font-field" name="easymde_windows_font" value="<?php echo esc_attr( $easymde_theme_state['windowsFont'] ); ?>">
	<input type="hidden" id="easymde-apple-font-field" name="easymde_apple_font" value="<?php echo esc_attr( $easymde_theme_state['appleFont'] ); ?>">
	<input type="hidden" id="easymde-serif-font-field" name="easymde_serif_font" value="<?php echo esc_attr( $easymde_theme_state['serifFont'] ); ?>">
	<div id="easymde-toolbar" class="easymde-toolbar" role="toolbar" aria-label="<?php esc_attr_e( 'Markdown toolbar', 'easymde' ); ?>" data-easymde-main-toolbar-owner="legacy">
		<div id="easymde-toolbar-react-main" class="easymde-toolbar-section easymde-toolbar-section-main" hidden></div>
		<div id="easymde-toolbar-legacy-main" class="easymde-toolbar-section easymde-toolbar-section-main"></div>
		<div id="easymde-toolbar-legacy-secondary" class="easymde-toolbar-section easymde-toolbar-section-secondary"></div>
	</div>
	<div class="easymde-workspace">
		<section class="easymde-pane easymde-pane-source">
			<header class="easymde-pane-header"><?php esc_html_e( 'Markdown', 'easymde' ); ?></header>
			<textarea id="easymde-source" name="easymde_markdown" class="easymde-source" spellcheck="false"><?php echo esc_textarea( $context['markdown'] ); ?></textarea>
		</section>
		<section class="easymde-pane easymde-pane-preview">
			<header class="easymde-pane-header"><?php esc_html_e( 'Preview', 'easymde' ); ?></header>
			<article
				id="easymde-preview"
				class="<?php echo esc_attr( $context['content_classes'] ); ?>"
				style="<?php echo esc_attr( $context['content_style'] ); ?>"
				data-easymde-initial-preview="<?php echo esc_attr( $easymde_initial_preview_ready ); ?>"
				data-easymde-initial-preview-provisional="<?php echo esc_attr( $easymde_initial_preview_provisional ); ?>"
				data-easymde-preview-features="<?php echo esc_attr( $easymde_initial_preview_features ); ?>"
				data-easymde-preview-refreshing="<?php echo esc_attr( $easymde_preview_refreshing ); ?>"
				aria-busy="<?php echo esc_attr( $easymde_preview_busy ); ?>"
				aria-live="polite"
				><?php echo $easymde_initial_preview; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Already sanitized before reaching the template. ?></article>
		</section>
		<aside id="easymde-side-actions" class="easymde-side-actions" aria-label="<?php esc_attr_e( 'Output actions', 'easymde' ); ?>"></aside>
	</div>
</div>
