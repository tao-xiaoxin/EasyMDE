<?php
/**
 * EasyMDE editor shell template.
 *
 * @var array<string,mixed> $context Prepared editor data.
 */

if (!defined('ABSPATH')) {
    exit;
}

$post = $context['post'];
$theme_state = $context['theme_state'];
?>
<div id="easymde-editor" class="easymde-editor" data-post-id="<?php echo esc_attr($post->ID); ?>">
    <input type="hidden" id="easymde-enabled-field" name="easymde_enabled" value="1">
    <input type="hidden" id="easymde-markdown-field" name="easymde_markdown" value="<?php echo esc_attr($context['markdown']); ?>">
    <input type="hidden" id="easymde-markdown-theme-field" name="easymde_markdown_theme" value="<?php echo esc_attr($theme_state['markdownTheme']); ?>">
    <input type="hidden" id="easymde-code-theme-field" name="easymde_code_theme" value="<?php echo esc_attr($theme_state['codeTheme']); ?>">
    <input type="hidden" id="easymde-code-mac-style-field" name="easymde_code_mac_style" value="<?php echo $theme_state['codeMacStyle'] ? '1' : '0'; ?>">
    <input type="hidden" id="easymde-custom-css-id-field" name="easymde_custom_css_id" value="<?php echo esc_attr($theme_state['customCssId']); ?>">
    <input type="hidden" id="easymde-custom-font-field" name="easymde_custom_font" value="<?php echo esc_attr($theme_state['customFont']); ?>">
    <input type="hidden" id="easymde-windows-font-field" name="easymde_windows_font" value="<?php echo esc_attr($theme_state['windowsFont']); ?>">
    <input type="hidden" id="easymde-apple-font-field" name="easymde_apple_font" value="<?php echo esc_attr($theme_state['appleFont']); ?>">
    <input type="hidden" id="easymde-serif-font-field" name="easymde_serif_font" value="<?php echo esc_attr($theme_state['serifFont']); ?>">
    <div class="easymde-toolbar" role="toolbar" aria-label="<?php esc_attr_e('Markdown toolbar', 'easymde'); ?>"></div>
    <div class="easymde-workspace">
        <section class="easymde-pane easymde-pane-source">
            <header class="easymde-pane-header"><?php esc_html_e('Markdown', 'easymde'); ?></header>
            <textarea id="easymde-source" class="easymde-source" spellcheck="false"><?php echo esc_textarea($context['markdown']); ?></textarea>
        </section>
        <section class="easymde-pane easymde-pane-preview">
            <header class="easymde-pane-header"><?php esc_html_e('Preview', 'easymde'); ?></header>
            <article id="easymde-preview" class="<?php echo esc_attr($context['content_classes']); ?>" style="<?php echo esc_attr($context['content_style']); ?>" aria-live="polite"></article>
        </section>
        <aside class="easymde-side-actions" aria-label="<?php esc_attr_e('Output actions', 'easymde'); ?>"></aside>
    </div>
</div>
