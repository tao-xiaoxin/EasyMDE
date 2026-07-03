<?php

use EasyMDE\Admin\PostModeController;
use EasyMDE\Content\PostDocument;

final class PostModeControllerTest extends WP_UnitTestCase
{
    private $previous_get;
    private $previous_pagenow;

    public function set_up()
    {
        parent::set_up();

        $this->previous_get = $_GET;
        $this->previous_pagenow = isset($GLOBALS['pagenow']) ? $GLOBALS['pagenow'] : null;
    }

    public function tear_down()
    {
        $_GET = $this->previous_get;

        if (null === $this->previous_pagenow) {
            unset($GLOBALS['pagenow']);
        } else {
            $GLOBALS['pagenow'] = $this->previous_pagenow;
        }

        parent::tear_down();
    }

    public function test_default_new_post_request_loads_easymde_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post-new.php';
        $_GET = array('post_type' => 'post');

        $controller = new PostModeController(new PostDocument());

        $this->assertTrue($controller->is_new_easymde_request('post'));
        $this->assertFalse($controller->maybe_disable_block_editor(true, (object) array(
            'ID' => 0,
            'post_type' => 'post',
        )));
        $this->assertTrue($controller->should_load_editor(0, 'post'));
    }

    public function test_default_new_page_request_loads_easymde_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post-new.php';
        $_GET = array('post_type' => 'page');

        $controller = new PostModeController(new PostDocument());

        $this->assertTrue($controller->is_new_easymde_request('page'));
        $this->assertFalse($controller->maybe_disable_block_editor(true, (object) array(
            'ID' => 0,
            'post_type' => 'page',
        )));
        $this->assertTrue($controller->should_load_editor(0, 'page'));
    }

    public function test_default_new_request_does_not_auto_enable_filtered_custom_post_type()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post-new.php';
        $_GET = array('post_type' => 'book');

        add_filter('easymde_supported_post_types', array($this, 'include_book_post_type'));

        try {
            $controller = new PostModeController(new PostDocument());

            $this->assertFalse($controller->is_new_easymde_request('book'));
            $this->assertTrue($controller->maybe_disable_block_editor(true, (object) array(
                'ID' => 0,
                'post_type' => 'book',
            )));
            $this->assertFalse($controller->should_load_editor(0, 'book'));
        } finally {
            remove_filter('easymde_supported_post_types', array($this, 'include_book_post_type'));
        }
    }

    public function include_book_post_type($post_types)
    {
        $post_types[] = 'book';

        return $post_types;
    }

    public function test_legacy_new_post_query_does_not_enable_existing_ordinary_post()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
            'easymde' => '1',
            'easymde_nonce' => 'legacy-new-post-nonce',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertFalse($controller->is_new_easymde_request('post'));
        $this->assertTrue($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertFalse($controller->should_load_editor($post_id, 'post'));
    }

    public function test_enabled_existing_post_loads_easymde_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );
        update_post_meta($post_id, PostDocument::META_ENABLED, '1');

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertFalse($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertTrue($controller->should_load_editor($post_id, 'post'));
    }

    public function test_legacy_markdown_existing_post_loads_easymde_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );
        add_post_meta($post_id, PostDocument::META_MARKDOWN, '');

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertFalse($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertTrue($controller->should_load_editor($post_id, 'post'));
    }
}
