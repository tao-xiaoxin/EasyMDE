<?php

use EasyMDE\Support\Options;

final class SettingsControllerTest extends WP_UnitTestCase {

    public function set_up() {
        parent::set_up();

        global $wp_rest_server;
        $wp_rest_server = new WP_REST_Server();
        do_action( 'rest_api_init' );
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    public function tear_down() {
        delete_option( Options::EDITOR_SETTINGS );
        wp_set_current_user( 0 );

        global $wp_rest_server;
        $wp_rest_server = null;

        parent::tear_down();
    }

    public function test_get_returns_the_complete_settings_contract_without_secrets() {
        $response = rest_do_request( new WP_REST_Request( 'GET', '/easymde/v1/settings' ) );
        $data     = $response->get_data();

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( array( 'settings' ), array_keys( $data ) );
        $this->assertSame( array( 'revision', 'general', 'images', 'markdown', 'shortcuts' ), array_keys( $data['settings'] ) );
        $this->assertSame( '', $data['settings']['images']['accessKey'] );
        $this->assertSame( '', $data['settings']['images']['secretKey'] );
    }

    public function test_post_accepts_a_complete_settings_object_and_returns_the_next_revision() {
        $settings = $this->current_settings();
        $settings['general']['autoSave'] = false;
        $settings['shortcuts']['values']['bold']['windows'] = 'Ctrl+Alt+B';

        $response = $this->post_json( array( 'settings' => $settings ) );
        $data     = $response->get_data();

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( 1, $data['settings']['revision'] );
        $this->assertFalse( $data['settings']['general']['autoSave'] );
        $this->assertSame( 'Ctrl+Alt+B', $data['settings']['shortcuts']['values']['bold']['windows'] );
    }

    public function test_first_post_creates_the_missing_option_with_revision_one() {
        $settings = $this->current_settings();
        $settings['general']['autoSave'] = false;

        $response = $this->post_json( array( 'settings' => $settings ) );
        $stored   = get_option( Options::EDITOR_SETTINGS, null );

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( 1, $response->get_data()['settings']['revision'] );
        $this->assertIsArray( $stored );
        $this->assertFalse( $stored['settings_center']['general']['autoSave'] );
    }

    public function test_post_rejects_incomplete_settings_payloads() {
        $settings                      = $this->current_settings();
        $missing_section               = $settings;
        $missing_image_field           = $settings;
        $missing_upload_format         = $settings;
        $missing_shortcut_platform     = $settings;
        unset( $missing_section['markdown'] );
        unset( $missing_image_field['images']['bucket'] );
        unset( $missing_upload_format['images']['uploadFormats']['gif'] );
        unset( $missing_shortcut_platform['shortcuts']['values']['bold']['mac'] );
        $payloads = array(
            array( 'revision' => $settings['revision'] ),
            $missing_section,
            $missing_image_field,
            $missing_upload_format,
            $missing_shortcut_platform,
        );

        foreach ( $payloads as $payload ) {
            $response = $this->post_json( array( 'settings' => $payload ) );

            $this->assertSame( 400, $response->get_status() );
            $this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );
        }
    }

    public function test_post_rejects_unknown_fields_invalid_types_and_invalid_shortcuts() {
        $settings = $this->current_settings();

        $unknown_field = $settings;
        $unknown_field['general']['unknown'] = true;
        $response = $this->post_json( array( 'settings' => $unknown_field ) );
        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );

        $invalid_type = $settings;
        $invalid_type['general']['autoSave'] = 'false';
        $response = $this->post_json( array( 'settings' => $invalid_type ) );
        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );

        $invalid_shortcut = $settings;
        $invalid_shortcut['shortcuts']['values']['bold']['windows'] = 'Alt+B';
        $response = $this->post_json( array( 'settings' => $invalid_shortcut ) );
        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_shortcut', $response->as_error()->get_error_code() );
    }

    public function test_reset_secrets_requires_a_complete_revisioned_settings_payload() {
        $settings = $this->current_settings();
        $settings['images']['accessKey'] = 'synthetic-access-key';
        $settings['images']['secretKey'] = 'synthetic-secret-key';
        $saved = $this->post_json( array( 'settings' => $settings ) )->get_data()['settings'];

        $stored = get_option( Options::EDITOR_SETTINGS );
        $this->assertSame( 'synthetic-access-key', $stored['settings_center']['images']['accessKey'] );

        $reset = $this->post_json( array( 'settings' => $saved, 'resetSecrets' => true ) );
        $data  = $reset->get_data();

        $this->assertSame( 200, $reset->get_status() );
        $this->assertSame( 2, $data['settings']['revision'] );
        $stored = get_option( Options::EDITOR_SETTINGS );
        $this->assertSame( '', $stored['settings_center']['images']['accessKey'] );
        $this->assertSame( '', $stored['settings_center']['images']['secretKey'] );
    }


    public function test_post_rejects_a_stale_revision_without_clobbering_newer_settings() {
        $first = $this->current_settings();
        $stale = $this->current_settings();
        $first['general']['autoSave'] = false;
        $this->assertSame( 200, $this->post_json( array( 'settings' => $first ) )->get_status() );

        $stale['general']['autoSave'] = true;
        $response = $this->post_json( array( 'settings' => $stale ) );

        $this->assertSame( 409, $response->get_status() );
        $this->assertSame( 'easymde_settings_conflict', $response->as_error()->get_error_code() );
        $this->assertFalse( $this->current_settings()['general']['autoSave'] );
    }

    public function test_settings_routes_require_manage_options() {
        $settings = $this->current_settings();
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

        $get_response  = rest_do_request( new WP_REST_Request( 'GET', '/easymde/v1/settings' ) );
        $post_response = $this->post_json( array( 'settings' => $settings ) );

        $this->assertSame( 403, $get_response->get_status() );
        $this->assertSame( 403, $post_response->get_status() );
        $this->assertSame( 'easymde_rest_cannot_manage_settings', $post_response->as_error()->get_error_code() );
    }

    public function test_post_requires_the_action_specific_nonce() {
        $settings = $this->current_settings();

        $missing = new WP_REST_Request( 'POST', '/easymde/v1/settings' );
        $missing->set_body_params( array( 'settings' => $settings ) );
        $missing_response = rest_do_request( $missing );

        $invalid = new WP_REST_Request( 'POST', '/easymde/v1/settings' );
        $invalid->set_header( 'X-EasyMDE-Settings-Nonce', 'invalid' );
        $invalid->set_body_params( array( 'settings' => $settings ) );
        $invalid_response = rest_do_request( $invalid );

        $this->assertSame( 403, $missing_response->get_status() );
        $this->assertSame( 'easymde_rest_invalid_settings_nonce', $missing_response->as_error()->get_error_code() );
        $this->assertSame( 403, $invalid_response->get_status() );
        $this->assertSame( 'easymde_rest_invalid_settings_nonce', $invalid_response->as_error()->get_error_code() );
    }

    public function test_post_rejects_oversized_and_invalid_domain_payloads() {
        $too_large = new WP_REST_Request( 'POST', '/easymde/v1/settings' );
        $too_large->set_header( 'X-EasyMDE-Settings-Nonce', wp_create_nonce( 'easymde_update_settings' ) );
        $too_large->set_header( 'Content-Length', (string) ( 65537 ) );
        $too_large->set_body( str_repeat( 'x', 65537 ) );
        $too_large_response = rest_do_request( $too_large );

        $invalid_domain = $this->current_settings();
        $invalid_domain['images']['domain'] = 'javascript:alert(1)';
        $invalid_domain_response = $this->post_json( array( 'settings' => $invalid_domain ) );

        $too_long_bucket = $this->current_settings();
        $too_long_bucket['images']['bucket'] = str_repeat( 'a', 161 );
        $too_long_bucket_response = $this->post_json( array( 'settings' => $too_long_bucket ) );

        $this->assertSame( 413, $too_large_response->get_status() );
        $this->assertSame( 'easymde_settings_payload_too_large', $too_large_response->as_error()->get_error_code() );
        $this->assertSame( 400, $invalid_domain_response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $invalid_domain_response->as_error()->get_error_code() );
        $this->assertSame( 400, $too_long_bucket_response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $too_long_bucket_response->as_error()->get_error_code() );
    }

    private function current_settings() {
        return rest_do_request( new WP_REST_Request( 'GET', '/easymde/v1/settings' ) )->get_data()['settings'];
    }

    private function post_json( array $payload ) {
        $request = new WP_REST_Request( 'POST', '/easymde/v1/settings' );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_header( 'X-EasyMDE-Settings-Nonce', wp_create_nonce( 'easymde_update_settings' ) );
        $request->set_body( wp_json_encode( $payload ) );

        return rest_do_request( $request );
    }
}
