<?php

namespace EasyMDE\Support;

use WP_Error;
use WP_REST_Request;

if (!defined('ABSPATH')) {
    exit;
}

final class Capabilities
{
    public function can_edit_post($post_id)
    {
        $post_id = absint($post_id);

        return $post_id > 0 && current_user_can('edit_post', $post_id);
    }

    public function can_preview(WP_REST_Request $request)
    {
        $post_id = absint($request->get_param('post_id'));
        if ($post_id > 0) {
            return $this->can_edit_post($post_id)
                ? true
                : $this->forbidden('easymde_rest_cannot_edit_post');
        }

        return current_user_can('edit_posts')
            ? true
            : $this->forbidden('easymde_rest_cannot_preview');
    }

    public function can_manage_custom_css(WP_REST_Request $request)
    {
        unset($request);

        return current_user_can('unfiltered_html')
            ? true
            : $this->forbidden('easymde_rest_cannot_manage_custom_css');
    }

    public function can_delete_custom_css(WP_REST_Request $request)
    {
        return $this->can_manage_custom_css($request);
    }

    private function forbidden($code)
    {
        return new WP_Error(
            $code,
            __('You are not allowed to perform this EasyMDE action.', 'easymde'),
            array('status' => is_user_logged_in() ? 403 : 401)
        );
    }
}
