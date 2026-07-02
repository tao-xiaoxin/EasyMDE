<?php

namespace EasyMDE\Frontend;

use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Asset;
use EasyMDE\Theme\ThemeStateRepository;

if (!defined('ABSPATH')) {
    exit;
}

final class FrontendAssets
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
        add_action('wp_enqueue_scripts', array($this, 'enqueue_frontend_assets'));
    }

    public function enqueue_frontend_assets()
    {
        if (!is_singular()) {
            return;
        }

        $post_id = get_queried_object_id();
        if (!$post_id || !$this->post_document->is_easymde_post($post_id)) {
            return;
        }

        $post = get_post($post_id);
        $markdown = $this->post_document->get_markdown($post);
        $theme_state = $this->theme_state_repository->get_theme_state($post_id);

        $this->enqueue_render_assets($post_id, $markdown, false);

        if (!empty($theme_state['scopedCustomCss'])) {
            wp_add_inline_style('easymde-article-theme', $theme_state['scopedCustomCss']);
        }

        $dependencies = array('easymde-enhancements');
        wp_enqueue_script(
            'easymde-frontend',
            Asset::url('assets/js/frontend/bootstrap.js'),
            $dependencies,
            EASYMDE_VERSION,
            true
        );

        wp_localize_script(
            'easymde-frontend',
            'EasyMDEFrontendConfig',
            array(
                'features' => $this->get_feature_config($markdown),
                'themeState' => $theme_state,
                'strings' => array(
                    'renderingFailed' => __('Rendering failed.', 'easymde'),
                ),
            )
        );
    }

    public function enqueue_render_assets($post_id = 0, $markdown = '', $editor_context = true)
    {
        $theme_state = $this->theme_state_repository->get_theme_state($post_id);
        $article_theme = $this->theme_state_repository->get_article_theme($theme_state['markdownTheme']);
        $code_theme = $this->theme_state_repository->get_code_theme($theme_state['codeTheme']);
        $features = $editor_context ? $this->get_all_features() : $this->get_feature_config($markdown);

        wp_enqueue_style(
            'easymde-content',
            Asset::url('assets/css/frontend/base.css'),
            array(),
            EASYMDE_VERSION
        );

        wp_enqueue_style(
            'easymde-article-theme',
            Asset::url($article_theme['asset_path']),
            array('easymde-content'),
            EASYMDE_VERSION
        );

        if (!empty($features['syntaxHighlight']) || (!empty($theme_state['codeMacStyle']) && !empty($features['codeBlocks']))) {
            wp_enqueue_style(
                'easymde-code-frame',
                Asset::url('assets/css/frontend/code-frame.css'),
                array('easymde-content'),
                EASYMDE_VERSION
            );
        }

        if (!empty($features['syntaxHighlight'])) {
            wp_enqueue_style(
                'easymde-highlight-theme',
                Asset::url($code_theme['asset_path']),
                array('easymde-content'),
                EASYMDE_VERSION
            );

            wp_enqueue_script(
                'easymde-highlight',
                Asset::url('assets/vendor/highlight/highlight.min.js'),
                array(),
                EASYMDE_VERSION,
                true
            );
        }

        if (!empty($features['math'])) {
            wp_enqueue_style(
                'easymde-math',
                Asset::url('assets/css/frontend/math.css'),
                array('easymde-content'),
                EASYMDE_VERSION
            );

            wp_enqueue_style(
                'easymde-katex',
                Asset::url('assets/vendor/katex/katex.min.css'),
                array(),
                EASYMDE_VERSION
            );

            wp_enqueue_script(
                'easymde-katex',
                Asset::url('assets/vendor/katex/katex.min.js'),
                array(),
                EASYMDE_VERSION,
                true
            );

            wp_enqueue_script(
                'easymde-math-renderer',
                Asset::url('assets/js/frontend/math.js'),
                array('easymde-katex'),
                EASYMDE_VERSION,
                true
            );
        }

        if (!empty($features['toc'])) {
            wp_enqueue_style(
                'easymde-toc',
                Asset::url('assets/css/frontend/toc.css'),
                array('easymde-content'),
                EASYMDE_VERSION
            );
        }

        if (!empty($features['mermaid'])) {
            wp_enqueue_script(
                'easymde-mermaid',
                Asset::url('assets/vendor/mermaid/mermaid.min.js'),
                array(),
                EASYMDE_VERSION,
                true
            );

            wp_enqueue_script(
                'easymde-mermaid-renderer',
                Asset::url('assets/js/frontend/mermaid.js'),
                array('easymde-mermaid'),
                EASYMDE_VERSION,
                true
            );
        }

        $dependencies = array();
        if (!empty($features['syntaxHighlight'])) {
            $dependencies[] = 'easymde-highlight';
        }

        if (!empty($features['math'])) {
            $dependencies[] = 'easymde-math-renderer';
        }

        if (!empty($features['mermaid'])) {
            $dependencies[] = 'easymde-mermaid-renderer';
        }

        wp_enqueue_script(
            'easymde-enhancements',
            Asset::url('assets/js/frontend/code-highlight.js'),
            $dependencies,
            EASYMDE_VERSION,
            true
        );
    }

    public function get_feature_config($markdown = '')
    {
        $markdown = (string) $markdown;
        $has_code_block = (bool) preg_match('/(^|\n)\s*(```|~~~)/i', $markdown);
        $has_code_fence = (bool) preg_match('/(^|\n)\s*(```|~~~)(?!\s*mermaid\b)/i', $markdown);

        return array(
            'darkMode' => true,
            'localDrafts' => true,
            'codeBlocks' => $has_code_block,
            'syntaxHighlight' => $has_code_fence,
            'mermaid' => (bool) preg_match('/(^|\n)\s*(```|~~~)\s*mermaid\b/i', $markdown),
            'math' => (bool) preg_match('/(\$\$[\s\S]+?\$\$|\\\\\[|\\\\\(|(?<!\\\\)\$[^\n$]+?(?<!\\\\)\$)/', $markdown),
            'toc' => (bool) preg_match('/^\s*\\[toc\\]\s*$/im', $markdown),
            'wechatCopy' => true,
        );
    }

    public function get_all_features()
    {
        return array(
            'darkMode' => true,
            'localDrafts' => true,
            'codeBlocks' => true,
            'syntaxHighlight' => true,
            'mermaid' => true,
            'math' => true,
            'toc' => true,
            'wechatCopy' => true,
        );
    }
}
