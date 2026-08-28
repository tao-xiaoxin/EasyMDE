<?php

use EasyMDE\Rest\ImageHostingController;
use EasyMDE\Support\Capabilities;
use EasyMDE\Plugin;

final class ImageHostingControllerTest extends WP_UnitTestCase {

	private $settings_provider;
	private $runtime;
	private $remote_downloader;
	private $post_id;
	private $plugin;

	public function set_up() {
		parent::set_up();

		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		$this->plugin = Plugin::instance();
		remove_action( 'rest_api_init', array( $this->plugin, 'register_rest_routes' ) );

		$this->settings_provider = new class() {
			public $max_bytes = 5242880;
			public $primary_domain = 'https://images.example.test';
			public $title_display = 'filename';

			public function get_image_hosting_settings() {
				return array(
					'revision'    => 7,
					'primary'     => array(
						'retryCount' => 2,
						'service'   => 'cloudflare-r2',
						'endpoint'  => 'https://synthetic-account.r2.cloudflarestorage.com',
						'bucket'    => 'synthetic-primary',
						'domain'    => $this->primary_domain,
						'accessKey' => 'synthetic-access',
						'secretKey' => 'synthetic-secret',
					),
					'backup'      => array(
						'enabled'       => true,
						'retryCount'    => 2,
						'service'       => 'qiniu-kodo',
						'endpoint'      => '',
						'bucket'        => 'synthetic-backup',
						'domain'        => 'https://backup.example.test',
						'accessKey'     => 'synthetic-backup-access',
						'secretKey'     => 'synthetic-backup-secret',
					),
						'behaviors'   => array(
							'uploadFormats' => array( 'jpg', 'png', 'webp', 'gif' ),
							'maxBytes'      => $this->max_bytes,
							'titleDisplay'  => $this->title_display,
						),
						'fileNameRule' => '{date}/{uuid}.{ext}',
				);
			}

			public function get_image_hosting_secret( $target, $field, $revision ) {
				$settings = $this->get_image_hosting_settings();
				if ( 7 !== $revision || ! isset( $settings[ $target ][ $field ] ) ) {
					return new WP_Error( 'easymde_image_hosting_secret_unavailable', 'Synthetic unavailable.', array( 'status' => 409 ) );
				}

				return $settings[ $target ][ $field ];
			}
		};

		$this->runtime = new class() {
			public $validation_calls = array();
			public $upload_calls     = array();
			public $validation_result = array(
				'status' => 'uploaded',
					'path'   => '20260824/验证图标-00000000-0000-4000-8000-000000000000.png',
					'url'    => 'https://images.example.test/20260824/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87-00000000-0000-4000-8000-000000000000.png',
			);
				public $upload_result = array(
					'url'         => 'https://images.example.test/2026/08/example.png',
					'path'        => '2026/08/example.png',
					'alt'         => 'example',
				'title'       => 'Example',
				'backup'      => array( 'status' => 'uploaded' ),
			);

			public function validate_upload( array $settings, $target ) {
				$this->validation_calls[] = array( $settings, $target );

				return $this->validation_result;
			}

			public function upload( array $settings, array $file ) {
				$this->upload_calls[] = array( $settings, $file );

				return $this->upload_result;
			}
		};

		$this->remote_downloader = new class() {
			public $calls = array();
			public $result;

			public function download( $url, $maximum_bytes ) {
				$this->calls[] = array( $url, $maximum_bytes );

				return $this->result;
			}
		};

		$controller = new ImageHostingController( new Capabilities(), $this->settings_provider, $this->runtime, $this->remote_downloader );
		add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
		do_action( 'rest_api_init' );
		remove_action( 'rest_api_init', array( $controller, 'register_routes' ) );

		$administrator = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $administrator );
		$this->post_id = self::factory()->post->create( array( 'post_author' => $administrator ) );
	}

	public function tear_down() {
		add_action( 'rest_api_init', array( $this->plugin, 'register_rest_routes' ) );
		wp_set_current_user( 0 );

		global $wp_rest_server;
		$wp_rest_server = null;

		parent::tear_down();
	}

	public function test_verification_performs_a_validation_upload_and_returns_only_its_path() {
		$response = rest_do_request( $this->verification_request( array( 'target' => 'primary' ) ) );
		$data = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'target' => 'primary',
				'status' => 'uploaded',
					'path'   => '20260824/验证图标-00000000-0000-4000-8000-000000000000.png',
					'url'    => 'https://images.example.test/20260824/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87-00000000-0000-4000-8000-000000000000.png',
			),
			$data
		);
		$this->assertCount( 1, $this->runtime->validation_calls );
		$this->assertSame( 'synthetic-secret', $this->runtime->validation_calls[0][0]['primary']['secretKey'] );
		$this->assertSame( '{date}/{uuid}.{ext}', $this->runtime->validation_calls[0][0]['fileNameRule'] );
		$this->assertArrayNotHasKey( 'retryCount', $this->runtime->validation_calls[0][0]['primary'] );
		$this->assertArrayNotHasKey( 'retryCount', $this->runtime->validation_calls[0][0]['backup'] );
		$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $data ) );
	}

	public function test_validation_upload_rejects_a_url_for_a_different_object_path() {
		$this->runtime->validation_result['url'] = 'https://images.example.test/20260824/different.png';

		$response = rest_do_request( $this->verification_request( array( 'target' => 'primary' ) ) );

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $response->as_error()->get_error_code() );
	}

	public function test_validation_upload_supports_an_http_primary_viewing_domain_with_the_exact_encoded_path() {
		$payload = $this->verification_payload( 'primary' );
		$payload['settings']['domain'] = 'http://images.example.test';
		$this->runtime->validation_result['url'] = 'http://images.example.test/20260824/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87-00000000-0000-4000-8000-000000000000.png';

		$response = rest_do_request( $this->verification_request( $payload ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $this->runtime->validation_result['url'], $response->get_data()['url'] );

		$this->runtime->validation_result['url'] = 'http://images.example.test/20260824/different.png';
		$wrong_path = rest_do_request( $this->verification_request( $payload ) );

		$this->assertSame( 500, $wrong_path->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $wrong_path->as_error()->get_error_code() );
	}

	public function test_backup_validation_returns_the_primary_viewing_domain_and_rejects_the_backup_domain() {
		$primary = rest_do_request( $this->verification_request( array( 'target' => 'backup' ) ) );

		$this->assertSame( 200, $primary->get_status() );
		$this->assertSame( 'https://images.example.test/20260824/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87-00000000-0000-4000-8000-000000000000.png', $primary->get_data()['url'] );

		$this->runtime->validation_result['url'] = 'https://backup.example.test/20260824/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87-00000000-0000-4000-8000-000000000000.png';
		$backup = rest_do_request( $this->verification_request( array( 'target' => 'backup' ) ) );

		$this->assertSame( 500, $backup->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $backup->as_error()->get_error_code() );
	}

	public function test_validation_upload_rejects_an_invalid_object_key_or_wrong_viewing_domain() {
		$cases = array(
			array( '../validation.png', 'https://images.example.test/validation.png' ),
			array( '20260824/validation.png', 'https://other.example.test/20260824/validation.png' ),
		);

		foreach ( $cases as $case ) {
			$this->runtime->validation_result['path'] = $case[0];
			$this->runtime->validation_result['url']  = $case[1];
			$response = rest_do_request( $this->verification_request( array( 'target' => 'primary' ) ) );

			$this->assertSame( 500, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $response->as_error()->get_error_code() );
		}
	}

	public function test_secret_reveal_requires_both_nonces_and_returns_one_current_stored_field_without_caching() {
		$response = rest_do_request( $this->secret_request( 'primary', 'secretKey', 7 ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'target' => 'primary',
				'field'  => 'secretKey',
				'value'  => 'synthetic-secret',
			),
			$response->get_data()
		);
		$this->assertSame( 'no-store, private', $response->get_headers()['Cache-Control'] );

		$missing_rest_nonce = $this->secret_request( 'primary', 'accessKey', 7 );
		$missing_rest_nonce->remove_header( 'X-WP-Nonce' );
		$missing_action_nonce = $this->secret_request( 'primary', 'accessKey', 7 );
		$missing_action_nonce->remove_header( 'X-EasyMDE-Image-Hosting-Secret-Nonce' );
		foreach ( array( $missing_rest_nonce, $missing_action_nonce ) as $invalid_request ) {
			$invalid = rest_do_request( $invalid_request );
			$this->assertSame( 403, $invalid->get_status() );
			$this->assertStringNotContainsString( 'synthetic-access', wp_json_encode( $invalid->get_data() ) );
		}
	}

	public function test_secret_reveal_rejects_non_admin_stale_revision_unknown_fields_and_extra_keys() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$forbidden = rest_do_request( $this->secret_request( 'backup', 'secretKey', 7 ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$stale = rest_do_request( $this->secret_request( 'primary', 'secretKey', 6 ) );
		$unknown = rest_do_request( $this->secret_request( 'primary', 'password', 7 ) );
		$extra_request = $this->secret_request( 'primary', 'secretKey', 7 );
		$extra_request->set_body( wp_json_encode( array( 'target' => 'primary', 'field' => 'secretKey', 'revision' => 7, 'extra' => true ) ) );
		$extra = rest_do_request( $extra_request );

		$this->assertSame( 403, $forbidden->get_status() );
		$this->assertSame( 409, $stale->get_status() );
		$this->assertSame( 400, $unknown->get_status() );
		$this->assertSame( 400, $extra->get_status() );
		foreach ( array( $forbidden, $stale, $unknown, $extra ) as $response ) {
			$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
		}
	}

	public function test_secret_reveal_is_not_available_over_get() {
		$request = new WP_REST_Request( 'GET', '/easymde/v1/image-hosting/secret' );
		$request->set_query_params(
			array(
				'target'   => 'primary',
				'field'    => 'secretKey',
				'revision' => 7,
			)
		);

		$response = rest_do_request( $request );

		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'rest_no_route', $response->as_error()->get_error_code() );
		$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
	}

	public function test_verification_uses_a_strict_current_draft_without_persisting_it() {
		$payload = $this->verification_payload( 'primary' );
		$payload['settings']['accessKey'] = 'draft-access';
		$payload['settings']['secretKey'] = 'draft-secret';
		$payload['settings']['bucket']    = 'draft-bucket';

		$response = rest_do_request( $this->verification_request( $payload ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'draft-bucket', $this->runtime->validation_calls[0][0]['primary']['bucket'] );
		$this->assertSame( 'draft-secret', $this->runtime->validation_calls[0][0]['primary']['secretKey'] );
		$this->assertStringNotContainsString( 'draft-secret', wp_json_encode( $response->get_data() ) );
		$this->assertSame( 7, $this->settings_provider->get_image_hosting_settings()['revision'] );
	}

	public function test_verification_reuses_saved_credentials_only_for_the_same_revision_and_target_identity() {
		$stale = $this->verification_payload( 'primary' );
		$stale['revision'] = 6;
		$changed = $this->verification_payload( 'primary' );
		$changed['settings']['bucket'] = 'changed-bucket';
		$partial = $this->verification_payload( 'primary' );
		$partial['settings']['accessKey'] = 'draft-access';

		foreach ( array( $stale, $changed, $partial ) as $payload ) {
			$response = rest_do_request( $this->verification_request( $payload ) );
			$this->assertSame( 409, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_draft_credentials_required', $response->as_error()->get_error_code() );
		}
		$this->assertCount( 0, $this->runtime->validation_calls );
	}

	public function test_verification_requires_manage_options_and_both_nonces() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$forbidden = rest_do_request( $this->verification_request( array( 'target' => 'primary' ) ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$missing_rest_nonce = $this->verification_request( array( 'target' => 'primary' ) );
		$missing_rest_nonce->remove_header( 'X-WP-Nonce' );
		$missing_action_nonce = $this->verification_request( array( 'target' => 'primary' ) );
		$missing_action_nonce->remove_header( 'X-EasyMDE-Image-Hosting-Nonce' );

		$this->assertSame( 403, $forbidden->get_status() );
		$this->assertSame( 'easymde_rest_cannot_manage_settings', $forbidden->as_error()->get_error_code() );
		foreach ( array( $missing_rest_nonce, $missing_action_nonce ) as $invalid_request ) {
			$invalid = rest_do_request( $invalid_request );
			$this->assertSame( 403, $invalid->get_status() );
			$this->assertSame( 'easymde_rest_invalid_image_hosting_nonce', $invalid->as_error()->get_error_code() );
		}
		$this->assertCount( 0, $this->runtime->validation_calls );
	}

	public function test_verification_rejects_unknown_targets_and_extra_fields() {
		$unknown_target = rest_do_request( $this->verification_request( array( 'target' => 'other' ) ) );
		$extra_field    = rest_do_request( $this->verification_request( array( 'target' => 'backup', 'endpoint' => 'https://attacker.example' ) ) );
		$removed_field  = $this->verification_payload( 'primary' );
		$removed_field['settings']['retryCount'] = '3';
		$removed_field = rest_do_request( $this->verification_request( $removed_field ) );
		$invalid_domain = $this->verification_payload( 'primary' );
		$invalid_domain['settings']['domain'] = 'https://images.example.test/private-path';
		$invalid_domain = rest_do_request( $this->verification_request( $invalid_domain ) );

		$this->assertSame( 400, $unknown_target->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_request', $unknown_target->as_error()->get_error_code() );
		$this->assertSame( 400, $extra_field->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_request', $extra_field->as_error()->get_error_code() );
		$this->assertSame( 400, $removed_field->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_request', $removed_field->as_error()->get_error_code() );
		$this->assertSame( 400, $invalid_domain->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_request', $invalid_domain->as_error()->get_error_code() );
		$this->assertCount( 0, $this->runtime->validation_calls );
	}

	public function test_verification_rejects_invalid_upload_retry_counts_without_calling_the_runtime() {
		foreach ( array( -1, 6, '2', 2.5 ) as $invalid ) {
			$payload = $this->verification_payload( 'primary' );
			$payload['settings']['uploadRetryCount'] = $invalid;

			$response = rest_do_request( $this->verification_request( $payload ) );

			$this->assertSame( 400, $response->get_status(), gettype( $invalid ) );
			$this->assertSame( 'easymde_image_hosting_invalid_request', $response->as_error()->get_error_code(), gettype( $invalid ) );
		}
		$this->assertCount( 0, $this->runtime->validation_calls );
	}

	public function test_upload_validates_the_file_and_returns_only_the_stable_browser_contract() {
		$file              = $this->png_file();
		$file['full_path'] = 'browser-folder/image.png';
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 200, $response->get_status() );
			$this->assertSame(
				array(
					'url'         => 'https://images.example.test/2026/08/example.png',
					'alt'         => 'example',
					'title'       => 'Example',
					'backup'      => array( 'status' => 'uploaded' ),
				),
				$response->get_data()
			);
				$this->assertCount( 1, $this->runtime->upload_calls );
				$this->assertSame( 2, $this->runtime->upload_calls[0][0]['primary']['retryCount'] );
				$this->assertSame( 2, $this->runtime->upload_calls[0][0]['backup']['retryCount'] );
			$this->assertSame( 'image.png', $this->runtime->upload_calls[0][1]['name'] );
			$this->assertSame( 'image/png', $this->runtime->upload_calls[0][1]['type'] );
			$this->assertArrayNotHasKey( 'full_path', $this->runtime->upload_calls[0][1] );
				$this->assertArrayNotHasKey( 'objectKey', $response->get_data() );
				$this->assertArrayNotHasKey( 'path', $response->get_data() );
			$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
			$this->assertSame( $this->post_id, $this->runtime->upload_calls[0][1]['post_id'] );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_with_full_path_rejects_svg_after_file_shape_validation() {
		$file     = $this->svg_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 415, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_unsupported_media_type', $response->as_error()->get_error_code() );
			$this->assertCount( 0, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_rejects_unknown_file_metadata_keys() {
		$file                = $this->png_file();
		$file['full_path']   = 'browser-folder/image.png';
		$file['client_path'] = '/untrusted/image.png';
		$response            = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 400, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_file', $response->as_error()->get_error_code() );
			$this->assertCount( 0, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_rejects_unsafe_full_path_metadata() {
		$file              = $this->png_file();
		$file['full_path'] = '../image.png';
		$response          = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 400, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_file', $response->as_error()->get_error_code() );
			$this->assertCount( 0, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_requires_editor_capability_and_an_action_nonce() {
		$file = $this->png_file();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$forbidden = rest_do_request( $this->upload_request( $file ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$missing_nonce = $this->upload_request( $file );
		$missing_nonce->remove_header( 'X-EasyMDE-Image-Hosting-Nonce' );
		$invalid = rest_do_request( $missing_nonce );

		try {
			$this->assertSame( 403, $forbidden->get_status() );
			$this->assertSame( 'easymde_rest_cannot_upload_media', $forbidden->as_error()->get_error_code() );
			$this->assertSame( 403, $invalid->get_status() );
			$this->assertSame( 'easymde_rest_invalid_image_hosting_nonce', $invalid->as_error()->get_error_code() );
			$this->assertCount( 0, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_rejects_extension_mime_mismatches_and_declared_size_mismatches() {
		$extension_mismatch         = $this->png_file();
		$extension_mismatch['name'] = 'image.jpg';
		$declared_size_mismatch     = $this->png_file();
		$declared_size_mismatch['size']++;

		$mime_response = rest_do_request( $this->upload_request( $extension_mismatch ) );
		$size_response = rest_do_request( $this->upload_request( $declared_size_mismatch ) );

		try {
			$this->assertSame( 415, $mime_response->get_status() );
			$this->assertSame( 'easymde_image_hosting_unsupported_media_type', $mime_response->as_error()->get_error_code() );
			$this->assertSame( 400, $size_response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_file', $size_response->as_error()->get_error_code() );
			$this->assertCount( 0, $this->runtime->upload_calls );
		} finally {
			unlink( $extension_mismatch['tmp_name'] );
			unlink( $declared_size_mismatch['tmp_name'] );
		}
	}

	public function test_upload_rejects_files_above_the_effective_configured_limit_before_runtime_upload() {
		$this->settings_provider->max_bytes = 1024;
		$file = $this->png_file();
		file_put_contents( $file['tmp_name'], str_repeat( "\0", 1025 ), FILE_APPEND );
		clearstatcache( true, $file['tmp_name'] );
		$file['size'] = filesize( $file['tmp_name'] );

		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 413, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_file_too_large', $response->as_error()->get_error_code() );
			$this->assertCount( 0, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_runtime_failures_are_redacted_and_never_retried() {
		$this->runtime->upload_result = new WP_Error(
			'provider_raw_failure',
			'Upstream response contained a synthetic secret.',
			array( 'status' => 500, 'raw' => 'synthetic-secret' )
		);
		$file     = $this->png_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 502, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_upload_failed', $response->as_error()->get_error_code() );
			$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
			$this->assertCount( 1, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_duplicate_destination_runtime_failures_preserve_only_the_stable_409_contract() {
		$this->runtime->validation_result = new WP_Error(
			'easymde_image_hosting_duplicate_destination',
			'Unsafe synthetic runtime detail.',
			array( 'status' => 500, 'raw' => 'synthetic-secret' )
		);
		$verification = rest_do_request( $this->verification_request( array( 'target' => 'primary' ) ) );

		$this->runtime->upload_result = new WP_Error(
			'easymde_image_hosting_duplicate_destination',
			'Unsafe synthetic runtime detail.',
			array( 'status' => 500, 'raw' => 'synthetic-secret' )
		);
		$file   = $this->png_file();
		$upload = rest_do_request( $this->upload_request( $file ) );

		try {
			foreach ( array( $verification, $upload ) as $response ) {
				$this->assertSame( 409, $response->get_status() );
				$this->assertSame( 'easymde_image_hosting_duplicate_destination', $response->as_error()->get_error_code() );
				$this->assertStringNotContainsString( 'Unsafe synthetic runtime detail', wp_json_encode( $response->get_data() ) );
				$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
			}
			$this->assertCount( 1, $this->runtime->validation_calls );
			$this->assertCount( 1, $this->runtime->upload_calls );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_rejects_a_partial_backup_failure_result() {
		$this->runtime->upload_result['backup'] = array(
			'status' => 'failed',
			'code'   => 'easymde_image_hosting_backup_upload_failed',
			'raw'    => 'synthetic-secret',
		);
		$file     = $this->png_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 500, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $response->as_error()->get_error_code() );
			$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_backup_runtime_failure_becomes_a_stable_upload_failure() {
		$this->runtime->upload_result = new WP_Error(
			'easymde_image_hosting_backup_upload_failed',
			'Unsafe synthetic provider detail.',
			array( 'status' => 502, 'raw' => 'synthetic-secret' )
		);
		$file = $this->png_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 502, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_upload_failed', $response->as_error()->get_error_code() );
			$this->assertStringNotContainsString( 'Unsafe synthetic provider detail', wp_json_encode( $response->get_data() ) );
			$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_rejects_an_unknown_backup_failure_code() {
		$this->runtime->upload_result['backup'] = array(
			'status' => 'failed',
			'code'   => 'synthetic-upstream-error',
		);
		$file     = $this->png_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 500, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $response->get_data()['code'] );
			$this->assertStringNotContainsString( 'synthetic-upstream-error', wp_json_encode( $response->get_data() ) );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_upload_rejects_unsafe_runtime_urls() {
		$urls = array(
			'https://user:password@images.example.test/image.png',
			'https://images.example.test/image.png?token=secret',
			'https://images.example.test/image.png#fragment',
		);

		foreach ( $urls as $url ) {
			$this->runtime->upload_result['url'] = $url;
			$file = $this->png_file();

			try {
				$response = rest_do_request( $this->upload_request( $file ) );
				$this->assertSame( 500, $response->get_status(), $url );
				$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $response->get_data()['code'], $url );
			} finally {
				unlink( $file['tmp_name'] );
			}
		}
	}

	public function test_upload_rejects_a_url_outside_the_primary_viewing_domain_or_path() {
		$cases = array(
			array( '2026/08/example.png', 'https://backup.example.test/2026/08/example.png' ),
			array( '2026/08/example.png', 'https://images.example.test/2026/08/different.png' ),
			array( '../example.png', 'https://images.example.test/example.png' ),
		);

		foreach ( $cases as $case ) {
			$this->runtime->upload_result['path'] = $case[0];
			$this->runtime->upload_result['url']  = $case[1];
			$file = $this->png_file();

			try {
				$response = rest_do_request( $this->upload_request( $file ) );
				$this->assertSame( 500, $response->get_status() );
				$this->assertSame( 'easymde_image_hosting_invalid_runtime_result', $response->get_data()['code'] );
			} finally {
				unlink( $file['tmp_name'] );
			}
		}
	}

	public function test_remote_import_downloads_once_uploads_once_projects_alt_and_cleans_the_temporary_file() {
		$file                            = $this->png_file();
		$this->remote_downloader->result = $file;

		$response = rest_do_request(
			$this->import_request(
				array(
					'post_id'  => $this->post_id,
					'url'      => 'https://cdn.example.test/path/source.png?version=1',
					'alt_text' => 'Remote image alt',
				)
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'status' => 'imported',
				'url'    => 'https://images.example.test/2026/08/example.png',
				'alt'    => 'Remote image alt',
				'title'  => 'Example',
				'backup' => array( 'status' => 'uploaded' ),
			),
			$response->get_data()
		);
		$this->assertSame( array( array( 'https://cdn.example.test/path/source.png?version=1', 5242880 ) ), $this->remote_downloader->calls );
		$this->assertCount( 1, $this->runtime->upload_calls );
		$this->assertSame( $this->post_id, $this->runtime->upload_calls[0][1]['post_id'] );
		$this->assertFileDoesNotExist( $file['tmp_name'] );
	}

	public function test_remote_import_returns_an_exact_primary_origin_without_downloading_or_uploading() {
		$this->settings_provider->primary_domain = 'https://PRIMARY-VIEWING.EXAMPLE.TEST';
		$url                                     = 'https://primary-viewing.example.test/path/source%20name.png';

		$response = rest_do_request(
			$this->import_request(
				array(
					'post_id'  => $this->post_id,
					'url'      => $url,
					'alt_text' => 'Remote image alt',
				)
			)
		);

		$this->assertCount( 0, $this->remote_downloader->calls );
		$this->assertCount( 0, $this->runtime->upload_calls );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'status' => 'unchanged',
				'url'    => $url,
				'alt'    => 'Remote image alt',
				'title'  => 'source-name.png',
			),
			$response->get_data()
		);

		$this->settings_provider->title_display = 'none';
		$without_title                         = 'https://primary-viewing.example.test/path/without-title.png';
		$second_response                       = rest_do_request(
			$this->import_request(
				array(
					'post_id'  => $this->post_id,
					'url'      => $without_title,
					'alt_text' => '',
				)
			)
		);

		$this->assertSame(
			array(
				'status' => 'unchanged',
				'url'    => $without_title,
				'alt'    => '',
				'title'  => '',
			),
			$second_response->get_data()
		);
		$this->assertCount( 0, $this->remote_downloader->calls );
		$this->assertCount( 0, $this->runtime->upload_calls );
	}

	public function test_remote_import_does_not_treat_related_hostnames_as_the_primary_hostname() {
		$urls = array(
			'https://backup.example.test/path/source.png',
			'https://cdn.images.example.test/path/source.png',
			'https://images.example.test.evil.test/path/source.png',
			'https://evilimages.example.test/path/source.png',
			'https://provider-cdn-a.example.test/path/source.png',
			'https://provider-cdn-b.example.test/path/source.png',
			'https://user:password@images.example.test/path/source.png',
			'https://images.example.test:443/path/source.png',
			'https://images.example.test/path/source.png?version=1',
			'https://images.example.test/path/source.png#preview',
			'http://images.example.test/path/source.png',
			'https://images.example.test./path/source.png',
			'https://imáges.example.test/path/source.png',
		);

		foreach ( $urls as $url ) {
			$file                            = $this->png_file();
			$this->remote_downloader->result = $file;
			$response                        = rest_do_request(
				$this->import_request(
					array(
						'post_id'  => $this->post_id,
						'url'      => $url,
						'alt_text' => '',
					)
				)
			);

			$this->assertSame( 200, $response->get_status(), $url );
			$this->assertFileDoesNotExist( $file['tmp_name'], $url );
		}

		$this->assertCount( count( $urls ), $this->remote_downloader->calls );
		$this->assertCount( count( $urls ), $this->runtime->upload_calls );
	}

	public function test_remote_import_requires_exact_typed_json_and_never_downloads_an_invalid_request() {
		$cases = array(
			array( 'post_id' => $this->post_id, 'url' => 'https://cdn.example.test/image.png' ),
			array( 'post_id' => (string) $this->post_id, 'url' => 'https://cdn.example.test/image.png', 'alt_text' => '' ),
			array( 'post_id' => $this->post_id, 'url' => 'https://cdn.example.test/image.png', 'alt_text' => '', 'extra' => true ),
		);

		foreach ( $cases as $payload ) {
			$response = rest_do_request( $this->import_request( $payload ) );
			$this->assertSame( 400, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_invalid_request', $response->as_error()->get_error_code() );
		}

		$this->assertCount( 0, $this->remote_downloader->calls );
		$this->assertCount( 0, $this->runtime->upload_calls );
	}

	public function test_remote_import_rejects_declared_or_actual_request_bodies_above_the_hard_limit() {
		$declared = $this->import_request( array() );
		$declared->set_header( 'Content-Length', (string) ( ImageHostingController::MAX_IMPORT_BODY + 1 ) );
		$actual = new class( 'POST', '/easymde/v1/image-hosting/import' ) extends WP_REST_Request {
			public $get_param_calls = 0;

			public function get_param( $key ) {
				$this->get_param_calls++;

				return parent::get_param( $key );
			}
		};
		$actual->set_header( 'Content-Type', 'application/json' );
		$actual->set_header( 'X-WP-Nonce', wp_create_nonce( 'wp_rest' ) );
		$actual->set_header( 'X-EasyMDE-Image-Hosting-Nonce', wp_create_nonce( ImageHostingController::UPLOAD_NONCE_ACTION ) );
		$actual->set_body(
			wp_json_encode(
				array(
					'post_id'  => $this->post_id,
					'url'      => 'https://cdn.example.test/' . str_repeat( 'x', ImageHostingController::MAX_IMPORT_BODY ),
					'alt_text' => '',
				)
			)
		);

		foreach ( array( $declared, $actual ) as $request ) {
			$response = rest_do_request( $request );
			$this->assertSame( 413, $response->get_status() );
			$this->assertSame( 'easymde_image_hosting_payload_too_large', $response->as_error()->get_error_code() );
		}
		$this->assertCount( 0, $this->remote_downloader->calls );
		$this->assertSame( 0, $actual->get_param_calls );
	}

	public function test_remote_import_requires_upload_capability_post_access_and_both_nonces() {
		$payload = array(
			'post_id'  => $this->post_id,
			'url'      => 'https://cdn.example.test/image.png',
			'alt_text' => '',
		);
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$forbidden = rest_do_request( $this->import_request( $payload ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$missing_action_nonce = $this->import_request( $payload );
		$missing_action_nonce->remove_header( 'X-EasyMDE-Image-Hosting-Nonce' );
		$invalid_action_nonce = rest_do_request( $missing_action_nonce );
		$missing_rest_nonce   = $this->import_request( $payload );
		$missing_rest_nonce->remove_header( 'X-WP-Nonce' );
		$invalid_rest_nonce = rest_do_request( $missing_rest_nonce );

		$this->assertSame( 403, $forbidden->get_status() );
		$this->assertSame( 'easymde_rest_cannot_upload_media', $forbidden->as_error()->get_error_code() );
		$this->assertSame( 403, $invalid_action_nonce->get_status() );
		$this->assertSame( 'easymde_rest_invalid_image_hosting_nonce', $invalid_action_nonce->as_error()->get_error_code() );
		$this->assertSame( 403, $invalid_rest_nonce->get_status() );
		$this->assertSame( 'easymde_rest_invalid_image_hosting_nonce', $invalid_rest_nonce->as_error()->get_error_code() );
		$this->assertCount( 0, $this->remote_downloader->calls );
	}

	public function test_remote_import_requires_access_to_the_named_post() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$response = rest_do_request(
			$this->import_request(
				array(
					'post_id'  => $this->post_id,
					'url'      => 'https://cdn.example.test/image.png',
					'alt_text' => '',
				)
			)
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'easymde_rest_cannot_edit_post', $response->as_error()->get_error_code() );
		$this->assertCount( 0, $this->remote_downloader->calls );
	}

	public function test_remote_import_redacts_download_failures_and_does_not_call_the_upload_runtime() {
		$this->remote_downloader->result = new WP_Error(
			'easymde_image_hosting_import_download_failed',
			'Synthetic private URL and transport detail.',
			array( 'status' => 502, 'raw' => 'synthetic-secret' )
		);

		$response = rest_do_request(
			$this->import_request(
				array(
					'post_id'  => $this->post_id,
					'url'      => 'https://cdn.example.test/image.png',
					'alt_text' => '',
				)
			)
		);

		$this->assertSame( 502, $response->get_status() );
		$this->assertSame( 'easymde_image_hosting_import_download_failed', $response->as_error()->get_error_code() );
		$this->assertStringNotContainsString( 'Synthetic private URL', wp_json_encode( $response->get_data() ) );
		$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
		$this->assertCount( 1, $this->remote_downloader->calls );
		$this->assertCount( 0, $this->runtime->upload_calls );
	}

	public function test_remote_import_cleans_the_download_after_an_upload_failure_without_retrying_import() {
		$file                            = $this->png_file();
		$this->remote_downloader->result = $file;
		$this->runtime->upload_result    = new WP_Error( 'synthetic_provider_error', 'Synthetic private detail.' );

		$response = rest_do_request(
			$this->import_request(
				array(
					'post_id'  => $this->post_id,
					'url'      => 'https://cdn.example.test/image.png',
					'alt_text' => '',
				)
			)
		);

		$this->assertSame( 502, $response->get_status() );
		$this->assertSame( 'easymde_image_hosting_upload_failed', $response->as_error()->get_error_code() );
		$this->assertCount( 1, $this->remote_downloader->calls );
		$this->assertCount( 1, $this->runtime->upload_calls );
		$this->assertFileDoesNotExist( $file['tmp_name'] );
	}

	private function verification_request( array $payload ) {
		if ( isset( $payload['target'] ) && ! array_key_exists( 'revision', $payload ) ) {
			$payload = array_merge( $this->verification_payload( $payload['target'] ), $payload );
		}
		$request = new WP_REST_Request( 'POST', '/easymde/v1/image-hosting/verification' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_header( 'X-WP-Nonce', wp_create_nonce( 'wp_rest' ) );
		$request->set_header( 'X-EasyMDE-Image-Hosting-Nonce', wp_create_nonce( ImageHostingController::VERIFICATION_NONCE_ACTION ) );
		$request->set_body( wp_json_encode( $payload ) );

		return $request;
	}

	private function secret_request( $target, $field, $revision ) {
		$request = new WP_REST_Request( 'POST', '/easymde/v1/image-hosting/secret' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_header( 'X-WP-Nonce', wp_create_nonce( 'wp_rest' ) );
		$request->set_header( 'X-EasyMDE-Image-Hosting-Secret-Nonce', wp_create_nonce( ImageHostingController::SECRET_REVEAL_NONCE_ACTION ) );
		$request->set_body(
			wp_json_encode(
				array(
					'target'   => $target,
					'field'    => $field,
					'revision' => $revision,
				)
			)
		);

		return $request;
	}

	private function verification_payload( $target ) {
		return array(
			'target'   => $target,
			'revision' => 7,
			'settings' => array(
				'service'             => 'cloudflare-r2',
				'endpoint'            => 'https://synthetic-account.r2.cloudflarestorage.com',
				'bucket'              => 'synthetic-primary',
				'domain'              => 'https://images.example.test',
				'accessKey'           => '',
				'secretKey'           => '',
				'fileNameRule'        => '{date}/{uuid}.{ext}',
				'uploadRetryCount'    => 3,
				'backupEnabled'       => true,
				'backupService'       => 'qiniu-kodo',
				'backupEndpoint'      => '',
				'backupBucket'        => 'synthetic-backup',
				'backupDomain'        => 'https://backup.example.test',
				'backupAccessKey'     => '',
				'backupSecretKey'     => '',
					'compressImages'      => true,
					'maxImageSizeMb'      => 5,
					'uploadFormats'       => array( 'jpg' => true, 'png' => true, 'webp' => true, 'gif' => true ),
					'titleDisplay'        => 'none',
			),
		);
	}

	private function upload_request( array $file ) {
		$request = new WP_REST_Request( 'POST', '/easymde/v1/image-hosting/upload' );
		$request->set_header( 'X-EasyMDE-Image-Hosting-Nonce', wp_create_nonce( ImageHostingController::UPLOAD_NONCE_ACTION ) );
		$request->set_param( 'post_id', $this->post_id );
		$request->set_file_params( array( 'file' => $file ) );

		return $request;
	}

	private function import_request( array $payload ) {
		$request = new WP_REST_Request( 'POST', '/easymde/v1/image-hosting/import' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_header( 'X-WP-Nonce', wp_create_nonce( 'wp_rest' ) );
		$request->set_header( 'X-EasyMDE-Image-Hosting-Nonce', wp_create_nonce( ImageHostingController::UPLOAD_NONCE_ACTION ) );
		$request->set_body( wp_json_encode( $payload ) );

		return $request;
	}

	private function png_file() {
		$path = wp_tempnam( 'image.png' );
		file_put_contents(
			$path,
			base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true )
		);

		return array(
			'name'     => 'image.png',
			'type'     => 'image/png',
			'tmp_name' => $path,
			'error'    => UPLOAD_ERR_OK,
			'size'     => filesize( $path ),
		);
	}

	private function svg_file() {
		$path = wp_tempnam( 'image.svg' );
		file_put_contents( $path, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>' );

		return array(
			'name'      => 'image.svg',
			'full_path' => 'browser-folder/image.svg',
			'type'      => 'image/svg+xml',
			'tmp_name'  => $path,
			'error'     => UPLOAD_ERR_OK,
			'size'      => filesize( $path ),
		);
	}
}
