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
        $this->assertSame( array( 'settings', 'credentialStatus' ), array_keys( $data ) );
        $this->assertSame( array( 'revision', 'general', 'images', 'markdown', 'shortcuts' ), array_keys( $data['settings'] ) );
        $this->assertSame(
            array(
                'primaryConfigured' => false,
                'backupConfigured'  => false,
            ),
            $data['credentialStatus']
        );
        $this->assertSame( '', $data['settings']['images']['accessKey'] );
        $this->assertSame( '', $data['settings']['images']['secretKey'] );
		foreach ( array( 'autoFocusEditor', 'cleanPastedContent', 'smartListRecognition', 'defaultCategory', 'featuredImagePlaceholder' ) as $removed ) {
			$this->assertArrayNotHasKey( $removed, $data['settings']['general'] );
		}
		$this->assertArrayNotHasKey( 'accountId', $data['settings']['images'] );
		foreach ( array( 'endpoint', 'domain', 'backupEndpoint', 'backupDomain' ) as $field ) {
			$this->assertArrayHasKey( $field, $data['settings']['images'] );
		}
		$this->assertSame( 0, $data['settings']['images']['uploadRetryCount'] );
		$this->assertSame( 5, $data['settings']['images']['maxImageSizeMb'] );
		$this->assertSame( 'none', $data['settings']['images']['titleDisplay'] );
		foreach ( array( 'fallbackDomain', 'backupSameObjectKey', 'backupFailureMode', 'retryCount', 'backupRetryCount', 'insertMarkdown', 'preserveFileName', 'copyUrl', 'maxImageSize', 'insertFormat', 'altSource', 'captionMode', 'featuredPlaceholder' ) as $removed ) {
			$this->assertArrayNotHasKey( $removed, $data['settings']['images'] );
		}
		$this->assertTrue( $data['settings']['general']['applyEditorThemeToFrontend'] );
		$this->assertTrue( $data['settings']['general']['showPublishedCodeCopyButton'] );
		$this->assertSame(
			array(
				'wordWrap',
				'githubFlavor',
				'smartPunctuation',
				'tableAlignment',
				'codeLineNumbers',
				'pasteAsMarkdown',
			),
			array_keys( $data['settings']['markdown'] )
		);
    }

	public function test_post_rejects_removed_markdown_fields_as_unknown_contract_keys() {
		foreach ( array( 'editorTheme', 'htmlRendering', 'editorFontSize', 'editorFont', 'codeTheme', 'toc', 'livePreview', 'fixedToolbar', 'taskLists', 'emoji', 'math', 'tableExtension', 'footnotes', 'definitionLists', 'imageSizeSyntax', 'lineEnding', 'unorderedMarker', 'orderedStart', 'blockquoteStyle' ) as $removed_key ) {
			$settings = $this->current_settings();
			$settings['markdown'][ $removed_key ] = 'toc' === $removed_key ? false : 'removed';

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 400, $response->get_status(), $removed_key );
			$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code(), $removed_key );
		}
	}

	public function test_post_rejects_removed_general_fields_as_unknown_contract_keys() {
		foreach ( array( 'autoFocusEditor', 'featuredImagePlaceholder', 'cleanPastedContent', 'smartListRecognition', 'defaultCategory' ) as $removed_key ) {
			$settings = $this->current_settings();
			$settings['general'][ $removed_key ] = false;

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 400, $response->get_status(), $removed_key );
			$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code(), $removed_key );
		}
	}

	public function test_post_rejects_removed_image_host_fields_as_unknown_contract_keys() {
		foreach ( array( 'destination', 'accountId', 'region', 'backupRegion', 'fallbackDomain', 'backupSameObjectKey', 'backupFailureMode', 'retryCount', 'backupRetryCount', 'insertMarkdown', 'preserveFileName', 'copyUrl', 'maxImageSize', 'insertFormat', 'altSource', 'captionMode', 'featuredPlaceholder' ) as $removed_key ) {
			$settings = $this->current_settings();
			$settings['images'][ $removed_key ] = 'removed';

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 400, $response->get_status(), $removed_key );
			$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code(), $removed_key );
		}
	}

    public function test_get_projects_settings_and_credential_status_from_one_option_snapshot() {
        $reads = 0;
        $filter = static function () use ( &$reads ) {
            $reads++;

            return array(
                'settings_center_revision' => 41,
                'settings_center'          => array(
                    'images' => array(
                        'accessKey' => 'snapshot-access',
                        'secretKey' => 'snapshot-secret',
                    ),
                ),
            );
        };
        add_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );

        try {
            $response = rest_do_request( new WP_REST_Request( 'GET', '/easymde/v1/settings' ) );
        } finally {
            remove_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );
        }

        $data = $response->get_data();
        $this->assertSame( 1, $reads );
        $this->assertSame( 41, $data['settings']['revision'] );
        $this->assertTrue( $data['credentialStatus']['primaryConfigured'] );
        $this->assertFalse( $data['credentialStatus']['backupConfigured'] );
        $this->assertSame( '', $data['settings']['images']['accessKey'] );
        $this->assertSame( '', $data['settings']['images']['secretKey'] );
    }

    public function test_post_accepts_a_complete_settings_object_and_returns_the_next_revision() {
        $settings = $this->current_settings();
        $settings['general']['autoSave'] = false;
		$settings['general']['autoSaveInterval'] = '5';
		$settings['images']['uploadRetryCount'] = 5;
        $settings['shortcuts']['values']['bold']['windows'] = 'Ctrl+Alt+B';

        $response = $this->post_json( array( 'settings' => $settings ) );
        $data     = $response->get_data();

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( array( 'settings', 'credentialStatus' ), array_keys( $data ) );
        $this->assertSame(
            array(
                'primaryConfigured' => false,
                'backupConfigured'  => false,
            ),
            $data['credentialStatus']
        );
        $this->assertSame( 1, $data['settings']['revision'] );
        $this->assertFalse( $data['settings']['general']['autoSave'] );
		$this->assertSame( '5', $data['settings']['general']['autoSaveInterval'] );
		$this->assertSame( 5, $data['settings']['images']['uploadRetryCount'] );
        $this->assertSame( 'Ctrl+Alt+B', $data['settings']['shortcuts']['values']['bold']['windows'] );
    }

	public function test_status_bar_mode_rest_contract_accepts_only_canonical_values() {
		foreach ( array( 'detailed', 'compact', 'hidden' ) as $mode ) {
			$settings = $this->current_settings();
			$settings['general']['statusBarMode'] = $mode;

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 200, $response->get_status(), $mode );
			$this->assertSame( $mode, $response->get_data()['settings']['general']['statusBarMode'], $mode );
		}

		foreach ( array( 'words-reading-time', 'words' ) as $legacy_mode ) {
			$settings = $this->current_settings();
			$settings['general']['statusBarMode'] = $legacy_mode;

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 400, $response->get_status(), $legacy_mode );
			$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code(), $legacy_mode );
		}
	}

	public function test_post_rejects_invalid_upload_retry_counts() {
		foreach ( array( 'uploadRetryCount' ) as $field ) {
			foreach ( array( -1, 6, '2', 2.5 ) as $invalid ) {
				$settings = $this->current_settings();
				$settings['images'][$field] = $invalid;

				$response = $this->post_json( array( 'settings' => $settings ) );

				$this->assertSame( 400, $response->get_status(), $field . ':' . gettype( $invalid ) );
				$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code(), $field . ':' . gettype( $invalid ) );
			}
		}
	}

	public function test_post_accepts_only_bounded_integer_image_sizes_and_title_display_modes() {
		foreach ( array( 1, 5, 10 ) as $valid_size ) {
			$settings = $this->current_settings();
			$settings['images']['maxImageSizeMb'] = $valid_size;
			$settings['images']['titleDisplay'] = 1 === $valid_size ? 'filename' : 'none';

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 200, $response->get_status(), (string) $valid_size );
			$this->assertSame( $valid_size, $response->get_data()['settings']['images']['maxImageSizeMb'] );
		}

		foreach ( array( 0, 11, '5', 5.5 ) as $invalid_size ) {
			$settings = $this->current_settings();
			$settings['images']['maxImageSizeMb'] = $invalid_size;
			$response = $this->post_json( array( 'settings' => $settings ) );
			$this->assertSame( 400, $response->get_status(), gettype( $invalid_size ) );
		}

		foreach ( array( '', 'upload', 'Filename' ) as $invalid_display ) {
			$settings = $this->current_settings();
			$settings['images']['titleDisplay'] = $invalid_display;
			$response = $this->post_json( array( 'settings' => $settings ) );
			$this->assertSame( 400, $response->get_status(), $invalid_display );
		}
	}

	public function test_post_accepts_each_supported_image_host_service_as_primary()
	{
		$cases = array(
			array( 'cloudflare-r2', 'https://synthetic.r2.cloudflarestorage.com', 'synthetic-bucket' ),
			array( 'qiniu-kodo', '', 'synthetic-bucket' ),
			array( 'aliyun-oss', 'https://oss-cn-hangzhou.aliyuncs.com', 'synthetic-bucket' ),
			array( 'tencent-cos', 'https://cos.ap-shanghai.myqcloud.com', 'synthetic-bucket-1250000000' ),
		);

		foreach ( $cases as $case ) {
			$settings = $this->current_settings();
			$settings['images']['service'] = $case[0];
			$settings['images']['endpoint'] = $case[1];
			$settings['images']['bucket'] = $case[2];

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 200, $response->get_status(), $case[0] );
			$this->assertSame( $case[0], $response->get_data()['settings']['images']['service'], $case[0] );
		}
	}

	public function test_post_accepts_official_r2_jurisdiction_endpoints()
	{
		foreach ( array( 'eu', 'us', 'fedramp' ) as $jurisdiction ) {
			$settings = $this->current_settings();
			$settings['images']['endpoint'] = 'https://synthetic-account.' . $jurisdiction . '.r2.cloudflarestorage.com';

			$response = $this->post_json( array( 'settings' => $settings ) );

			$this->assertSame( 200, $response->get_status(), $jurisdiction );
		}
	}

	public function test_post_rejects_non_applicable_provider_coordinates()
	{
		$qiniu = $this->current_settings();
		$qiniu['images']['service'] = 'qiniu-kodo';
		$qiniu['images']['endpoint'] = 'https://synthetic.r2.cloudflarestorage.com';
		$oss = $this->current_settings();
		$oss['images']['service'] = 'aliyun-oss';
		$oss['images']['endpoint'] = 'https://synthetic.r2.cloudflarestorage.com';
		$cos = $this->current_settings();
		$cos['images']['service'] = 'tencent-cos';
		$cos['images']['endpoint'] = 'https://oss-cn-hangzhou.aliyuncs.com';

		foreach ( array( $qiniu, $oss, $cos ) as $settings ) {
			$response = $this->post_json( array( 'settings' => $settings ) );
			$this->assertSame( 400, $response->get_status() );
			$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );
		}
	}

	public function test_post_rejects_duplicate_enabled_image_host_destinations_with_a_conflict()
	{
		$settings = $this->current_settings();
		$settings['images']['service'] = 'qiniu-kodo';
		$settings['images']['endpoint'] = '';
		$settings['images']['bucket'] = 'same-bucket';
		$settings['images']['backupEnabled'] = true;
		$settings['images']['backupService'] = 'qiniu-kodo';
		$settings['images']['backupBucket'] = 'SAME-BUCKET';

		$response = $this->post_json( array( 'settings' => $settings ) );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'easymde_settings_duplicate_image_host_destination', $response->as_error()->get_error_code() );
	}

    public function test_successful_post_and_following_get_return_authoritative_credential_status_without_secrets() {
        $settings = $this->current_settings();
        $settings['images']['accessKey'] = 'synthetic-primary-access';
        $settings['images']['secretKey'] = 'synthetic-primary-secret';
        $settings['images']['backupAccessKey'] = 'synthetic-backup-access';
        $settings['images']['backupSecretKey'] = 'synthetic-backup-secret';

        $post_response = $this->post_json( array( 'settings' => $settings ) );
        $post_data     = $post_response->get_data();
        $get_response  = rest_do_request( new WP_REST_Request( 'GET', '/easymde/v1/settings' ) );
        $get_data      = $get_response->get_data();
        $expected_status = array(
            'primaryConfigured' => true,
            'backupConfigured'  => true,
        );

        $this->assertSame( 200, $post_response->get_status() );
        $this->assertSame( array( 'settings', 'credentialStatus' ), array_keys( $post_data ) );
        $this->assertSame( $expected_status, $post_data['credentialStatus'] );
        $this->assertSame( '', $post_data['settings']['images']['accessKey'] );
        $this->assertSame( '', $post_data['settings']['images']['secretKey'] );
        $this->assertSame( '', $post_data['settings']['images']['backupAccessKey'] );
        $this->assertSame( '', $post_data['settings']['images']['backupSecretKey'] );

        $this->assertSame( 200, $get_response->get_status() );
        $this->assertSame( array( 'settings', 'credentialStatus' ), array_keys( $get_data ) );
        $this->assertSame( $expected_status, $get_data['credentialStatus'] );
        $this->assertSame( '', $get_data['settings']['images']['accessKey'] );
        $this->assertSame( '', $get_data['settings']['images']['secretKey'] );
        $this->assertStringNotContainsString( 'synthetic-primary-secret', wp_json_encode( $post_data ) );
        $this->assertStringNotContainsString( 'synthetic-backup-secret', wp_json_encode( $get_data ) );
    }

    public function test_successful_post_projects_the_cas_result_without_a_second_option_read() {
        $settings = $this->current_settings();
        $settings['images']['accessKey'] = 'cas-access';
        $settings['images']['secretKey'] = 'cas-secret';
        $reads = 0;
        $filter = static function ( $value ) use ( &$reads ) {
            $reads++;

            return $value;
        };
        add_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );

        try {
            $response = $this->post_json( array( 'settings' => $settings ) );
        } finally {
            remove_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );
        }

        $data = $response->get_data();
        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( 0, $reads );
        $this->assertSame( 1, $data['settings']['revision'] );
        $this->assertTrue( $data['credentialStatus']['primaryConfigured'] );
        $this->assertSame( '', $data['settings']['images']['accessKey'] );
        $this->assertSame( '', $data['settings']['images']['secretKey'] );
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

		$invalid_theme_linkage = $settings;
		$invalid_theme_linkage['general']['applyEditorThemeToFrontend'] = 'true';
		$response = $this->post_json( array( 'settings' => $invalid_theme_linkage ) );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );

		$invalid_code_copy = $settings;
		$invalid_code_copy['general']['showPublishedCodeCopyButton'] = 'true';
		$response = $this->post_json( array( 'settings' => $invalid_code_copy ) );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );

        $invalid_shortcut = $settings;
        $invalid_shortcut['shortcuts']['values']['bold']['windows'] = 'Alt+B';
        $response = $this->post_json( array( 'settings' => $invalid_shortcut ) );
        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_shortcut', $response->as_error()->get_error_code() );
    }

    public function test_post_rejects_the_retired_syntax_highlight_field() {
        $settings = $this->current_settings();
        $this->assertArrayNotHasKey( 'syntaxHighlight', $settings['general'] );
        $settings['general']['syntaxHighlight'] = false;

        $response = $this->post_json( array( 'settings' => $settings ) );

        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $response->as_error()->get_error_code() );
        $this->assertFalse( get_option( Options::EDITOR_SETTINGS, false ) );
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
        $this->assertArrayNotHasKey( 'credentialStatus', $response->get_data() );
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

		$invalid_rule = $this->current_settings();
		$invalid_rule['images']['fileNameRule'] = '../{name}.{ext}';
		$invalid_rule_response = $this->post_json( array( 'settings' => $invalid_rule ) );

		$unsupported_provider = $this->current_settings();
		$unsupported_provider['images']['service'] = 'unsupported-provider';
		$unsupported_provider_response = $this->post_json( array( 'settings' => $unsupported_provider ) );

		$invalid_endpoint = $this->current_settings();
		$invalid_endpoint['images']['endpoint'] = 'https://not-r2.example.test';
		$invalid_endpoint_response = $this->post_json( array( 'settings' => $invalid_endpoint ) );

		$invalid_provider_endpoint = $this->current_settings();
		$invalid_provider_endpoint['images']['service'] = 'aliyun-oss';
		$invalid_provider_endpoint['images']['endpoint'] = 'https://oss-cn-hangzhou-.aliyuncs.com';
		$invalid_provider_endpoint_response = $this->post_json( array( 'settings' => $invalid_provider_endpoint ) );

        $too_long_bucket = $this->current_settings();
		$too_long_bucket['images']['bucket'] = str_repeat( 'a', 129 );
        $too_long_bucket_response = $this->post_json( array( 'settings' => $too_long_bucket ) );

        $this->assertSame( 413, $too_large_response->get_status() );
        $this->assertSame( 'easymde_settings_payload_too_large', $too_large_response->as_error()->get_error_code() );
        $this->assertSame( 400, $invalid_domain_response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $invalid_domain_response->as_error()->get_error_code() );
		$this->assertSame( 400, $invalid_rule_response->get_status() );
		$this->assertSame( 'easymde_settings_invalid_payload', $invalid_rule_response->as_error()->get_error_code() );
		$this->assertSame( 400, $unsupported_provider_response->get_status() );
		$this->assertSame( 'easymde_settings_invalid_payload', $unsupported_provider_response->as_error()->get_error_code() );
		$this->assertSame( 400, $invalid_endpoint_response->get_status() );
		$this->assertSame( 'easymde_settings_invalid_payload', $invalid_endpoint_response->as_error()->get_error_code() );
		$this->assertSame( 400, $invalid_provider_endpoint_response->get_status() );
		$this->assertSame( 'easymde_settings_invalid_payload', $invalid_provider_endpoint_response->as_error()->get_error_code() );
        $this->assertSame( 400, $too_long_bucket_response->get_status() );
        $this->assertSame( 'easymde_settings_invalid_payload', $too_long_bucket_response->as_error()->get_error_code() );
    }

	public function test_post_accepts_http_primary_and_backup_viewing_domains() {
		$settings = $this->current_settings();
		$settings['images']['domain'] = 'http://images.example.test';
		$settings['images']['backupDomain'] = 'http://backup.example.test';

		$response = $this->post_json( array( 'settings' => $settings ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'http://images.example.test', $response->get_data()['settings']['images']['domain'] );
		$this->assertSame( 'http://backup.example.test', $response->get_data()['settings']['images']['backupDomain'] );
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
