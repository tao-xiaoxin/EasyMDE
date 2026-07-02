<?php

namespace EasyMDE\Content;

use EasyMDE\Theme\ThemeStateRepository;

if (!defined('ABSPATH')) {
    exit;
}

final class RevisionManager
{
    private $post_document;
    private $theme_state_repository;
    private $renderer_available_callback;
    private $restoring = false;

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
        add_filter('wp_post_revision_meta_keys', array($this, 'register_revision_meta_keys'));
        add_action('_wp_put_post_revision', array($this, 'save_revision_meta'), 10, 1);
        add_action('save_post', array($this, 'sync_latest_revision_meta_after_save'), 20, 3);
        add_action('wp_restore_post_revision', array($this, 'restore_revision_meta'), 10, 2);
    }

    public function register_revision_meta_keys($keys)
    {
        foreach ($this->post_document->revision_meta_keys() as $key) {
            if (!in_array($key, $keys, true)) {
                $keys[] = $key;
            }
        }

        return $keys;
    }

    public function save_revision_meta($revision_id)
    {
        $parent_id = wp_is_post_revision($revision_id);
        if (!$parent_id || !$this->post_document->is_easymde_post($parent_id)) {
            return;
        }

        foreach ($this->post_document->revision_meta_keys() as $key) {
            if (metadata_exists('post', $parent_id, $key)) {
                update_metadata('post', $revision_id, $key, get_post_meta($parent_id, $key, true));
            } else {
                delete_metadata('post', $revision_id, $key);
            }
        }
    }

    public function sync_latest_revision_meta_after_save($post_id, $post, $update)
    {
        unset($update);

        if ($this->restoring || wp_is_post_revision($post_id) || !$post || !$this->post_document->is_easymde_post($post_id)) {
            return;
        }

        $revisions = wp_get_post_revisions(
            $post_id,
            array(
                'posts_per_page' => 5,
                'orderby' => 'date',
                'order' => 'DESC',
            )
        );

        if (empty($revisions)) {
            return;
        }

        foreach ($revisions as $revision) {
            $revision_id = is_object($revision) && isset($revision->ID) ? absint($revision->ID) : absint($revision);
            if ($revision_id > 0 && !wp_is_post_autosave($revision_id)) {
                $this->save_revision_meta($revision_id);
                break;
            }
        }
    }

    public function restore_revision_meta($post_id, $revision_id)
    {
        if ($this->restoring || !$post_id || !$revision_id) {
            return;
        }

        $has_easymde_meta = false;
        foreach ($this->post_document->revision_meta_keys() as $key) {
            if (metadata_exists('post', $revision_id, $key)) {
                $has_easymde_meta = true;
                break;
            }
        }

        if (!$has_easymde_meta) {
            return;
        }

        $this->restoring = true;

        try {
            foreach ($this->post_document->revision_meta_keys() as $key) {
                if (metadata_exists('post', $revision_id, $key)) {
                    update_post_meta($post_id, $key, get_post_meta($revision_id, $key, true));
                } else {
                    delete_post_meta($post_id, $key);
                }
            }

            if ($this->post_document->is_easymde_post($post_id)) {
                $this->restore_post_content($post_id, $revision_id);
            }
        } catch (\RuntimeException $exception) {
            unset($exception);
        } finally {
            $this->restoring = false;
        }
    }

    private function restore_post_content($post_id, $revision_id)
    {
        $content = null;

        if ($this->is_renderer_available()) {
            try {
                $theme_state = $this->theme_state_repository->get_theme_state($post_id);
                $markdown = (string) get_post_meta($post_id, PostDocument::META_MARKDOWN, true);
                $content = MarkdownRenderer::render($markdown, $theme_state['markdownTheme']);
            } catch (\Throwable $exception) {
                unset($exception);
            }
        }

        if (null === $content) {
            $revision = get_post(absint($revision_id));
            if (!$revision) {
                return;
            }

            $content = (string) $revision->post_content;
        }

        global $wpdb;

        $wpdb->update(
            $wpdb->posts,
            array('post_content' => $content),
            array('ID' => $post_id),
            array('%s'),
            array('%d')
        );
        clean_post_cache($post_id);
    }

    private function is_renderer_available()
    {
        return (bool) call_user_func($this->renderer_available_callback);
    }
}
