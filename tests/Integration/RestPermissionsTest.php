<?php

use EasyMDE\Support\Capabilities;

final class RestPermissionsTest extends WP_UnitTestCase
{
    public function set_up()
    {
        parent::set_up();

        global $wp_rest_server;
        $wp_rest_server = new WP_REST_Server();
        do_action('rest_api_init');
    }

    public function tear_down()
    {
        global $wp_rest_server;
        $wp_rest_server = null;

        parent::tear_down();
    }

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

        $request = new WP_REST_Request('POST', '/easymde/v1/preview');
        $request->set_body_params(
            array(
                'post_id' => $post_id,
                'markdown' => '# Forbidden',
            )
        );

        $response = rest_do_request($request);
        $this->assertSame(403, $response->get_status());
    }

    public function test_user_with_edit_posts_can_preview_without_post_id()
    {
        $user_id = self::factory()->user->create(array('role' => 'author'));
        wp_set_current_user($user_id);

        $request = new WP_REST_Request('POST', '/easymde/v1/preview');

        $this->assertTrue((new Capabilities())->can_preview($request));

        $request->set_body_params(array('markdown' => "```php\necho 'Allowed';\n```"));
        $response = rest_do_request($request);
        $data = $response->get_data();

        $this->assertSame(200, $response->get_status());
        $this->assertStringContainsString('Allowed', $data['html']);
        $this->assertTrue($data['features']['codeBlocks']);
        $this->assertTrue($data['features']['syntaxHighlight']);
        $this->assertFalse($data['features']['math']);
        $this->assertFalse($data['features']['mermaid']);
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

    public function test_custom_css_create_update_and_delete_require_unfiltered_html()
    {
        $user_id = self::factory()->user->create(array('role' => 'author'));
        wp_set_current_user($user_id);

        $create = new WP_REST_Request('POST', '/easymde/v1/custom-css');
        $create->set_body_params(
            array(
                'name' => 'Blocked',
                'css' => 'h2 { color: red; }',
            )
        );

        $this->assertSame(403, rest_do_request($create)->get_status());

        $update = new WP_REST_Request('POST', '/easymde/v1/custom-css');
        $update->set_body_params(
            array(
                'id' => 'blocked',
                'name' => 'Blocked',
                'css' => 'h2 { color: blue; }',
            )
        );

        $this->assertSame(403, rest_do_request($update)->get_status());

        $delete = new WP_REST_Request('DELETE', '/easymde/v1/custom-css/blocked');

        $this->assertSame(403, rest_do_request($delete)->get_status());
    }

    public function test_custom_css_library_is_scoped_to_current_user()
    {
        $owner_id = self::factory()->user->create(array('role' => 'administrator'));
        $other_id = self::factory()->user->create(array('role' => 'administrator'));

        wp_set_current_user($owner_id);

        $create = new WP_REST_Request('POST', '/easymde/v1/custom-css');
        $create->set_body_params(
            array(
                'name' => 'Owner Style',
                'css' => 'h2 { color: red; }',
            )
        );

        $create_response = rest_do_request($create);
        $this->assertSame(200, $create_response->get_status());
        $style_id = $create_response->get_data()['item']['id'];

        wp_set_current_user($other_id);

        $options = new WP_REST_Request('GET', '/easymde/v1/theme-options');
        $options_response = rest_do_request($options);

        $this->assertSame(200, $options_response->get_status());
        $this->assertSame(array(), $options_response->get_data()['customCss']);

        $delete = new WP_REST_Request('DELETE', '/easymde/v1/custom-css/' . $style_id);
        $delete_response = rest_do_request($delete);

        $this->assertSame(404, $delete_response->get_status());

        wp_set_current_user($owner_id);
        $owner_options_response = rest_do_request($options);

        $this->assertCount(1, $owner_options_response->get_data()['customCss']);
        $this->assertSame('Owner Style', $owner_options_response->get_data()['customCss'][0]['name']);
    }
}
