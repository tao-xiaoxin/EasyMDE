<?php

use EasyMDE\Admin\EditorScreen;
use EasyMDE\Admin\PostModeController;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class PostModeControllerTest extends WP_UnitTestCase
{
    private $previous_get;
    private $previous_post;
    private $previous_pagenow;

    public function set_up()
    {
        parent::set_up();

        $this->previous_get = $_GET;
        $this->previous_post = $_POST;
        $this->previous_pagenow = isset($GLOBALS['pagenow']) ? $GLOBALS['pagenow'] : null;
    }

    public function tear_down()
    {
        $_GET = $this->previous_get;
        $_POST = $this->previous_post;

        if (null === $this->previous_pagenow) {
            unset($GLOBALS['pagenow']);
        } else {
            $GLOBALS['pagenow'] = $this->previous_pagenow;
        }

        remove_filter('easymde_supported_post_types', array($this, 'include_book_post_type'));
        if (post_type_exists('book')) {
            unregister_post_type('book');
        }
        if (post_type_exists('movie')) {
            unregister_post_type('movie');
        }

        wp_set_current_user(0);

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

    public function test_supported_new_custom_post_type_request_loads_easymde_editor()
    {
        $this->register_custom_post_type('book');
        add_filter('easymde_supported_post_types', array($this, 'include_book_post_type'));

        $user_id = self::factory()->user->create(array('role' => 'editor'));
        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post-new.php';
        $_GET = array('post_type' => 'book');

        $controller = new PostModeController(new PostDocument());

        $this->assertTrue($controller->is_new_easymde_request('book'));
        $this->assertFalse($controller->maybe_disable_block_editor(true, (object) array(
            'ID' => 0,
            'post_type' => 'book',
        )));
        $this->assertTrue($controller->should_load_editor(0, 'book'));
    }

    public function test_existing_ordinary_post_without_easymde_meta_loads_easymde_editor()
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
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_ENABLED));
        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_MARKDOWN));
        $this->assertFalse($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertTrue($controller->should_load_editor($post_id, 'post'));
    }

    public function test_existing_ordinary_page_without_easymde_meta_loads_easymde_editor()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'page',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_ENABLED));
        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_MARKDOWN));
        $this->assertFalse($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertTrue($controller->should_load_editor($post_id, 'page'));
    }

    public function test_legacy_new_post_query_parameter_does_not_control_existing_post_editor_admission()
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
        $this->assertFalse($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertTrue($controller->should_load_editor($post_id, 'post'));
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

    public function test_existing_supported_custom_post_type_loads_easymde_editor()
    {
        $this->register_custom_post_type('book');
        add_filter('easymde_supported_post_types', array($this, 'include_book_post_type'));

        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'book',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertFalse(metadata_exists('post', $post_id, PostDocument::META_MARKDOWN));
        $this->assertFalse($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertTrue($controller->should_load_editor($post_id, 'book'));
    }

    public function test_unsupported_post_type_keeps_wordpress_editor()
    {
        $this->register_custom_post_type('movie');

        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'movie',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
            'easymde' => '1',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertTrue($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertFalse($controller->should_load_editor($post_id, 'movie'));
    }

    public function test_opening_existing_ordinary_post_renders_editor_without_writing_post_state()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
                'post_content' => '<p>Existing HTML content.</p>',
            )
        );

        wp_set_current_user($user_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );
        $_POST = array();

        $before_content = get_post($post_id)->post_content;
        $before_meta = get_post_meta($post_id);
        $before_revision_count = count(wp_get_post_revisions($post_id));

        $post_document = new PostDocument();
        $controller = new PostModeController($post_document);
        $screen = new EditorScreen($post_document, $controller, $this->theme_state_repository());

        ob_start();
        $screen->render_editor_shell(get_post($post_id));
        $output = ob_get_clean();

        $this->assertStringContainsString('id="easymde-editor"', $output);
        $this->assertStringContainsString('Existing HTML content.', $output);
        $this->assertSame($before_content, get_post($post_id)->post_content);
        $this->assertSame($before_meta, get_post_meta($post_id));
        $this->assertSame($before_revision_count, count(wp_get_post_revisions($post_id)));
    }

    public function test_post_list_edit_link_and_direct_edit_entry_use_same_editor_rule()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        wp_set_current_user($user_id);

        $controller = new PostModeController(new PostDocument());
        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );

        $this->assertTrue($controller->should_load_editor($post_id, 'post'));

        $edit_link = html_entity_decode((string) get_edit_post_link($post_id, 'raw'));
        $this->assertStringContainsString('post.php?post=' . $post_id, $edit_link);

        $parts = wp_parse_url($edit_link);
        parse_str(isset($parts['query']) ? $parts['query'] : '', $_GET);
        $GLOBALS['pagenow'] = isset($parts['path']) ? basename($parts['path']) : 'post.php';

        $this->assertSame('post.php', $GLOBALS['pagenow']);
        $this->assertSame((string) $post_id, $_GET['post']);
        $this->assertSame('edit', $_GET['action']);
        $this->assertTrue($controller->should_load_editor($post_id, 'post'));
    }

    public function test_user_without_edit_permission_cannot_use_easymde_editor_for_post()
    {
        $owner_id = self::factory()->user->create(array('role' => 'editor'));
        $viewer_id = self::factory()->user->create(array('role' => 'subscriber'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $owner_id,
            )
        );

        wp_set_current_user($viewer_id);

        $GLOBALS['pagenow'] = 'post.php';
        $_GET = array(
            'post' => (string) $post_id,
            'action' => 'edit',
        );

        $controller = new PostModeController(new PostDocument());

        $this->assertTrue($controller->maybe_disable_block_editor(true, get_post($post_id)));
        $this->assertFalse($controller->should_load_editor($post_id, 'post'));
    }

    public function include_book_post_type($post_types)
    {
        $post_types[] = 'book';

        return $post_types;
    }

    private function register_custom_post_type($post_type)
    {
        register_post_type(
            $post_type,
            array(
                'public' => true,
                'show_ui' => true,
                'supports' => array('title', 'editor'),
                'capability_type' => 'post',
                'map_meta_cap' => true,
            )
        );
    }

    private function theme_state_repository()
    {
        return new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );
    }
}
