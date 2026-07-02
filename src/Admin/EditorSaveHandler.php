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
    private $renderer_available_callback;

    public function __construct(
        PostDocument $post_document,
        ThemeStateRepository $theme_state_repository,
        ?callable $renderer_available_callback = null
    ) {
        $this->post_document = $post_document;
        $this->theme_state_repository = $theme_state_repository;
        $this->renderer_available_callback = $renderer_available_callback ?: array(MarkdownRenderer::class, 'is_available');
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

        if (!current_user_can('edit_post', $post_id)) {
            return;
        }

        if (!$this->is_renderer_available()) {
            $this->abort_renderer_unavailable();

            return;
        }

        $markdown = wp_unslash($_POST['easymde_markdown']);
        $theme_state = $this->theme_state_repository->sanitize_theme_state_from_request($_POST, $post_id);

        $this->post_document->mark_enabled($post_id);
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
        if (!$this->has_valid_save_request()) {
            return $data;
        }

        if (empty($postarr['post_type']) || !$this->post_document->is_supported_post_type($postarr['post_type'])) {
            return $data;
        }

        if (!empty($postarr['ID']) && !current_user_can('edit_post', absint($postarr['ID']))) {
            return $data;
        }

        if (!$this->is_renderer_available()) {
            $this->abort_renderer_unavailable();

            return $data;
        }

        $markdown = wp_unslash($_POST['easymde_markdown']);
        $theme_state = $this->theme_state_repository->sanitize_theme_state_from_request($_POST, isset($postarr['ID']) ? absint($postarr['ID']) : 0);

        try {
            $data['post_content'] = MarkdownRenderer::render($markdown, $theme_state['markdownTheme']);
        } catch (\Throwable $exception) {
            unset($exception);

            $this->abort_renderer_unavailable();

            return $data;
        }

        return $data;
    }

    private function has_valid_save_request()
    {
        if (!isset($_POST['easymde_nonce'], $_POST['easymde_markdown'], $_POST['easymde_enabled'])) {
            return false;
        }

        if ('1' !== (string) wp_unslash($_POST['easymde_enabled'])) {
            return false;
        }

        $nonce = sanitize_text_field(wp_unslash($_POST['easymde_nonce']));

        return wp_verify_nonce($nonce, 'easymde_save_markdown');
    }

    private function is_renderer_available()
    {
        return (bool) call_user_func($this->renderer_available_callback);
    }

    private function abort_renderer_unavailable()
    {
        wp_die(
            esc_html__('EasyMDE cannot save this post because Markdown rendering is unavailable. Install Composer dependencies and try again.', 'easymde'),
            esc_html__('EasyMDE renderer unavailable', 'easymde'),
            array(
                'response' => 500,
                'back_link' => true,
            )
        );
    }
}
