<?php

namespace EasyMDE\Support;

use EasyMDE\Content\PostDocument;

if (!defined('ABSPATH')) {
    exit;
}

final class Migration
{
    public function is_easymde_enabled($post_id)
    {
        $post_id = absint($post_id);
        if (!$post_id) {
            return false;
        }

        if (metadata_exists('post', $post_id, PostDocument::META_ENABLED)) {
            return '1' === (string) get_post_meta($post_id, PostDocument::META_ENABLED, true);
        }

        return $this->has_legacy_markdown($post_id);
    }

    public function has_legacy_markdown($post_id)
    {
        $post_id = absint($post_id);

        return $post_id > 0 && metadata_exists('post', $post_id, PostDocument::META_MARKDOWN);
    }

    public function mark_enabled($post_id)
    {
        update_post_meta(absint($post_id), PostDocument::META_ENABLED, '1');
    }

    public function get_markdown($post)
    {
        if (!$post) {
            return '';
        }

        $post_id = is_object($post) ? absint($post->ID) : absint($post);
        if ($this->has_legacy_markdown($post_id)) {
            return (string) get_post_meta($post_id, PostDocument::META_MARKDOWN, true);
        }

        $post_object = is_object($post) ? $post : get_post($post_id);

        return $post_object ? (string) $post_object->post_content : '';
    }

    public function revision_meta_keys()
    {
        return array(
            PostDocument::META_ENABLED,
            PostDocument::META_MARKDOWN,
            PostDocument::META_MARKDOWN_THEME,
            PostDocument::META_CODE_THEME,
            PostDocument::META_CODE_MAC_STYLE,
            PostDocument::META_CUSTOM_CSS_ID,
            PostDocument::META_CUSTOM_CSS_SNAPSHOT,
        );
    }
}
