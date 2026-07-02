<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ThemeStateRepository;

if (!defined('ABSPATH')) {
    exit;
}

final class EditorSaveHandler
{
    private $post_document;
    private $theme_state_repository;

    public function __construct(PostDocument $post_document, ThemeStateRepository $theme_state_repository)
    {
        $this->post_document = $post_document;
        $this->theme_state_repository = $theme_state_repository;
    }

    public function register_hooks()
    {
        add_action('save_post', array($this, 'save_post_meta'), 10, 3);
        add_filter('wp_insert_post_data', array($this, 'render_markdown_post_content'), 10, 2);
    }

    public function save_post_meta($post_id, $post, $update)
    {
        unset($update);

        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }

        if (wp_is_post_revision($post_id) || !$post || !$this->post_document->is_supported_post_type($post->post_type)) {
            return;
        }

        if (!$this->has_valid_save_request()) {
            return;
        }

        if (!current_user_can('edit_post', $post_id) || !MarkdownRenderer::is_available()) {
            return;
        }

        $markdown = wp_unslash($_POST['easymde_markdown']);
        $theme_state = $this->theme_state_repository->sanitize_theme_state_from_request($_POST);

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, $markdown);
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, $theme_state['markdownTheme']);
        update_post_meta($post_id, PostDocument::META_CODE_THEME, $theme_state['codeTheme']);
        update_post_meta($post_id, PostDocument::META_CODE_MAC_STYLE, $theme_state['codeMacStyle'] ? '1' : '0');
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_ID, $theme_state['customCssId']);
        update_post_meta($post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, $theme_state['customCss']);
        update_post_meta($post_id, PostDocument::META_CUSTOM_FONT, $theme_state['customFont']);
        update_post_meta($post_id, PostDocument::META_WINDOWS_FONT, $theme_state['windowsFont']);
        update_post_meta($post_id, PostDocument::META_APPLE_FONT, $theme_state['appleFont']);
        update_post_meta($post_id, PostDocument::META_SERIF_FONT, $theme_state['serifFont']);

        $this->theme_state_repository->save_user_defaults($theme_state);
    }

    public function render_markdown_post_content($data, $postarr)
    {
        if (!$this->has_valid_save_request() || !MarkdownRenderer::is_available()) {
            return $data;
        }

        if (empty($postarr['post_type']) || !$this->post_document->is_supported_post_type($postarr['post_type'])) {
            return $data;
        }

        if (!empty($postarr['ID']) && !current_user_can('edit_post', absint($postarr['ID']))) {
            return $data;
        }

        $markdown = wp_unslash($_POST['easymde_markdown']);
        $theme_state = $this->theme_state_repository->sanitize_theme_state_from_request($_POST);

        try {
            $data['post_content'] = MarkdownRenderer::render($markdown, $theme_state['markdownTheme']);
        } catch (\RuntimeException $exception) {
            unset($exception);
        }

        return $data;
    }

    private function has_valid_save_request()
    {
        if (!isset($_POST['easymde_nonce'], $_POST['easymde_markdown'])) {
            return false;
        }

        $nonce = sanitize_text_field(wp_unslash($_POST['easymde_nonce']));

        return wp_verify_nonce($nonce, 'easymde_save_markdown');
    }
}
