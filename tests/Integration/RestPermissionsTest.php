<?php

use EasyMDE\Support\Capabilities;

final class RestPermissionsTest extends WP_UnitTestCase
{
    public function test_user_without_post_edit_capability_cannot_preview_specific_post()
    {
        $owner_id = self::factory()->user->create(array('role' => 'editor'));
        $viewer_id = self::factory()->user->create(array('role' => 'author'));
        $post_id = self::factory()->post->create(
            array(
                'post_author' => $owner_id,
                'post_status' => 'publish',
            )
        );

        wp_set_current_user($viewer_id);

        $request = new WP_REST_Request('POST', '/easymde/v1/preview');
        $request->set_param('post_id', $post_id);

        $result = (new Capabilities())->can_preview($request);

        $this->assertWPError($result);
        $this->assertSame(403, $result->get_error_data()['status']);
    }

    public function test_user_with_edit_posts_can_preview_without_post_id()
    {
        $user_id = self::factory()->user->create(array('role' => 'author'));
        wp_set_current_user($user_id);

        $request = new WP_REST_Request('POST', '/easymde/v1/preview');

        $this->assertTrue((new Capabilities())->can_preview($request));
    }

    public function test_user_without_unfiltered_html_cannot_delete_custom_css()
    {
        $user_id = self::factory()->user->create(array('role' => 'author'));
        wp_set_current_user($user_id);

        $request = new WP_REST_Request('DELETE', '/easymde/v1/custom-css/example');
        $result = (new Capabilities())->can_delete_custom_css($request);

        $this->assertWPError($result);
        $this->assertSame(403, $result->get_error_data()['status']);
    }
}
