<?php

use EasyMDE\Admin\PostModeController;
use EasyMDE\Content\PostDocument;

final class PostModeControllerTest extends WP_UnitTestCase
{
    public function test_real_easymde_new_post_request_loads_easymde_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);

        $previous_get = $_GET;
        $previous_pagenow = isset($GLOBALS['pagenow']) ? $GLOBALS['pagenow'] : null;

        try {
            $GLOBALS['pagenow'] = 'post-new.php';
            $_GET = array(
                'post_type' => 'post',
                'easymde' => '1',
                'easymde_nonce' => wp_create_nonce('easymde_new_post'),
            );

            $controller = new PostModeController(new PostDocument());

            $this->assertTrue($controller->is_new_easymde_request('post'));
            $this->assertFalse($controller->maybe_disable_block_editor(true, (object) array(
                'ID' => 0,
                'post_type' => 'post',
            )));
            $this->assertTrue($controller->should_load_editor(0, 'post'));
        } finally {
            $_GET = $previous_get;
            if (null === $previous_pagenow) {
                unset($GLOBALS['pagenow']);
            } else {
                $GLOBALS['pagenow'] = $previous_pagenow;
            }
        }
    }

    public function test_ordinary_new_post_request_keeps_block_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);

        $previous_get = $_GET;
        $previous_pagenow = isset($GLOBALS['pagenow']) ? $GLOBALS['pagenow'] : null;

        try {
            $GLOBALS['pagenow'] = 'post-new.php';
            $_GET = array('post_type' => 'post');

            $controller = new PostModeController(new PostDocument());

            $this->assertFalse($controller->is_new_easymde_request('post'));
            $this->assertTrue($controller->maybe_disable_block_editor(true, (object) array(
                'ID' => 0,
                'post_type' => 'post',
            )));
            $this->assertFalse($controller->should_load_editor(0, 'post'));
        } finally {
            $_GET = $previous_get;
            if (null === $previous_pagenow) {
                unset($GLOBALS['pagenow']);
            } else {
                $GLOBALS['pagenow'] = $previous_pagenow;
            }
        }
    }

    public function test_new_post_nonce_does_not_enable_existing_ordinary_post()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $previous_get = $_GET;
        $previous_pagenow = isset($GLOBALS['pagenow']) ? $GLOBALS['pagenow'] : null;

        try {
            $GLOBALS['pagenow'] = 'post.php';
            $_GET = array(
                'post' => (string) $post_id,
                'action' => 'edit',
                'easymde' => '1',
                'easymde_nonce' => wp_create_nonce('easymde_new_post'),
            );

            $controller = new PostModeController(new PostDocument());

            $this->assertFalse($controller->is_new_easymde_request('post'));
            $this->assertTrue($controller->maybe_disable_block_editor(true, get_post($post_id)));
        } finally {
            $_GET = $previous_get;
            if (null === $previous_pagenow) {
                unset($GLOBALS['pagenow']);
            } else {
                $GLOBALS['pagenow'] = $previous_pagenow;
            }
        }
    }
}
