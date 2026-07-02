<?php

namespace EasyMDE\Content;

if (!defined('ABSPATH')) {
    exit;
}

final class PostDocument
{
    const META_ENABLED = '_easymde_enabled';
    const META_MARKDOWN = '_easymde_markdown';
    const META_MARKDOWN_THEME = '_easymde_markdown_theme';
    const META_CODE_THEME = '_easymde_code_theme';
    const META_CODE_MAC_STYLE = '_easymde_code_mac_style';
    const META_CUSTOM_CSS_ID = '_easymde_custom_css_id';
    const META_CUSTOM_CSS_SNAPSHOT = '_easymde_custom_css_snapshot';
    const META_CUSTOM_FONT = '_easymde_custom_font';
    const META_WINDOWS_FONT = '_easymde_windows_font';
    const META_APPLE_FONT = '_easymde_apple_font';
    const META_SERIF_FONT = '_easymde_serif_font';

    public function is_supported_post_type($post_type)
    {
        $supported = apply_filters('easymde_supported_post_types', array('post', 'page'));

        return in_array($post_type, $supported, true);
    }

    public function is_easymde_post($post_id)
    {
        $post_id = absint($post_id);
        if (!$post_id) {
            return false;
        }

        $post = get_post($post_id);
        if (!$post || !$this->is_supported_post_type($post->post_type)) {
            return false;
        }

        if (metadata_exists('post', $post_id, self::META_ENABLED)) {
            return '1' === (string) get_post_meta($post_id, self::META_ENABLED, true);
        }

        return metadata_exists('post', $post_id, self::META_MARKDOWN);
    }

    public function get_markdown($post)
    {
        if (!$post) {
            return '';
        }

        $post_id = is_object($post) ? absint($post->ID) : absint($post);
        if ($post_id && metadata_exists('post', $post_id, self::META_MARKDOWN)) {
            return (string) get_post_meta($post_id, self::META_MARKDOWN, true);
        }

        $post_object = is_object($post) ? $post : get_post($post_id);

        return $post_object ? (string) $post_object->post_content : '';
    }

    public function revision_meta_keys()
    {
        return array(
            self::META_ENABLED,
            self::META_MARKDOWN,
            self::META_MARKDOWN_THEME,
            self::META_CODE_THEME,
            self::META_CODE_MAC_STYLE,
            self::META_CUSTOM_CSS_ID,
            self::META_CUSTOM_CSS_SNAPSHOT,
        );
    }
}
