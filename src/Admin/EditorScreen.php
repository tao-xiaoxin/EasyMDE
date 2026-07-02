<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ThemeStateRepository;

if (!defined('ABSPATH')) {
    exit;
}

final class EditorScreen
{
    private $post_document;
    private $post_mode_controller;
    private $theme_state_repository;

    public function __construct(
        PostDocument $post_document,
        PostModeController $post_mode_controller,
        ThemeStateRepository $theme_state_repository
    ) {
        $this->post_document = $post_document;
        $this->post_mode_controller = $post_mode_controller;
        $this->theme_state_repository = $theme_state_repository;
    }

    public function register_hooks()
    {
        add_action('edit_form_after_title', array($this, 'render_editor_shell'));
        add_action('admin_notices', array($this, 'render_dependency_notice'));
    }

    public function render_editor_shell($post)
    {
        if (!$post || !$this->post_mode_controller->should_load_editor($post->ID, $post->post_type)) {
            return;
        }

        $context = array(
            'post' => $post,
            'markdown' => $this->post_document->get_markdown($post),
            'theme_state' => $this->theme_state_repository->get_theme_state($post->ID),
            'content_classes' => '',
            'content_style' => '',
        );
        $context['content_classes'] = $this->theme_state_repository->get_rendered_content_classes($context['theme_state'], 'easymde-preview');
        $context['content_style'] = $this->theme_state_repository->get_rendered_content_style($context['theme_state']);

        wp_nonce_field('easymde_save_markdown', 'easymde_nonce');
        require EASYMDE_PLUGIN_DIR . 'templates/admin/editor-shell.php';
    }

    public function render_dependency_notice()
    {
        if (MarkdownRenderer::is_available()) {
            return;
        }

        echo '<div class="notice notice-error"><p>';
        echo esc_html__('EasyMDE requires Composer dependencies before Markdown can be rendered or saved. Run composer install for development or include vendor/ in release packages.', 'easymde');
        echo '</p></div>';
    }
}
