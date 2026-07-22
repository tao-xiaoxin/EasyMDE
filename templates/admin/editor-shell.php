<?php
/**
 * EasyMDE editor shell template.
 *
 * @var array<string,mixed> $context Prepared editor data.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$easymde_editor_post = $context['post'];
$easymde_theme_state = $context['theme_state'];
?>
<div id="easymde-editor" data-post-id="<?php echo esc_attr( $easymde_editor_post->ID ); ?>">
	<input type="hidden" id="easymde-enabled-field" name="easymde_enabled" value="1">
	<input type="hidden" id="easymde-markdown-theme-field" name="easymde_markdown_theme" value="<?php echo esc_attr( $easymde_theme_state['markdownTheme'] ); ?>">
	<input type="hidden" id="easymde-code-theme-field" name="easymde_code_theme" value="<?php echo esc_attr( $easymde_theme_state['codeTheme'] ); ?>">
	<input type="hidden" id="easymde-custom-css-id-field" name="easymde_custom_css_id" value="<?php echo esc_attr( $easymde_theme_state['customCssId'] ); ?>">
	<input type="hidden" id="easymde-custom-font-field" name="easymde_custom_font" value="<?php echo esc_attr( $easymde_theme_state['customFont'] ); ?>">
	<input type="hidden" id="easymde-windows-font-field" name="easymde_windows_font" value="<?php echo esc_attr( $easymde_theme_state['windowsFont'] ); ?>">
	<input type="hidden" id="easymde-apple-font-field" name="easymde_apple_font" value="<?php echo esc_attr( $easymde_theme_state['appleFont'] ); ?>">
	<input type="hidden" id="easymde-serif-font-field" name="easymde_serif_font" value="<?php echo esc_attr( $easymde_theme_state['serifFont'] ); ?>">
	<textarea id="easymde-source" name="easymde_markdown"><?php echo esc_textarea( $context['markdown'] ); ?></textarea>
	<div
		id="easymde-editor-root"
		data-failure-message="<?php echo esc_attr__( 'The EasyMDE editor could not start. Your WordPress fields remain available.', 'easymde' ); ?>"
	></div>
	<noscript>
		<div class="notice notice-error"><p><?php esc_html_e( 'EasyMDE requires JavaScript to edit Markdown on this screen.', 'easymde' ); ?></p></div>
	</noscript>
</div>
