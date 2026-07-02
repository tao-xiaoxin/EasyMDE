<?php

namespace EasyMDE\Frontend;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ThemeStateRepository;

if (!defined('ABSPATH')) {
    exit;
}

final class ContentFilter
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
        add_filter('the_content', array($this, 'render_markdown_content'), 12);
    }

    public function render_markdown_content($content)
    {
        if (is_admin() || !is_singular()) {
            return $content;
        }

        $post_id = get_the_ID();
        if (!$post_id || !$this->post_document->is_easymde_post($post_id) || !MarkdownRenderer::is_available()) {
            return $content;
        }

        $post = get_post($post_id);
        $markdown = $this->post_document->get_markdown($post);
        $theme_state = $this->theme_state_repository->get_theme_state($post_id);
        $style = $this->theme_state_repository->get_rendered_content_style($theme_state);

        try {
            $html = MarkdownRenderer::render($markdown, $theme_state['markdownTheme']);
        } catch (\RuntimeException $exception) {
            unset($exception);

            return $content;
        }

        return sprintf(
            '<div class="%s"%s>%s</div>',
            esc_attr($this->theme_state_repository->get_rendered_content_classes($theme_state)),
            '' !== $style ? ' style="' . esc_attr($style) . '"' : '',
            $html
        );
    }
}
