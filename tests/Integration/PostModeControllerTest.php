<?php

use EasyMDE\Admin\PostModeController;
use EasyMDE\Content\PostDocument;

final class PostModeControllerTest extends WP_UnitTestCase
{
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
