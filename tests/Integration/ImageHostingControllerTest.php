<?php

use EasyMDE\Rest\ImageHostingController;
use EasyMDE\Support\Capabilities;
use EasyMDE\Plugin;

final class ImageHostingControllerTest extends WP_UnitTestCase {

	private $settings_provider;
	private $runtime;
	private $post_id;
	private $plugin;

	public function set_up() {
		parent::set_up();

		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		$this->plugin = Plugin::instance();
		remove_action( 'rest_api_init', array( $this->plugin, 'register_rest_routes' ) );

		$this->settings_provider = new class() {
			public function get_image_hosting_settings() {
				return array(
					'primary'     => array(
						'service'   => 'cloudflare-r2',
						'accountId' => 'synthetic-account',
						'bucket'    => 'synthetic-primary',
						'domain'    => 'https://images.example.test',
						'accessKey' => 'synthetic-access',
						'secretKey' => 'synthetic-secret',
					),
					'backup'      => array(
						'enabled'       => true,
						'service'       => 'qiniu-kodo',
						'bucket'        => 'synthetic-backup',
						'domain'        => 'https://backup.example.test',
						'accessKey'     => 'synthetic-backup-access',
						'secretKey'     => 'synthetic-backup-secret',
						'sameObjectKey' => true,
						'failureMode'   => 'continue',
					),
					'behaviors'   => array(
						'uploadFormats' => array( 'jpg', 'png', 'webp', 'gif' ),
					),
				);
			}
		};

		$this->runtime = new class() {
			public $connection_calls = array();
			public $upload_calls     = array();
			public $connection_result = array( 'status' => 'connected' );
			public $upload_result = array(
				'url'    => 'https://images.example.test/2026/08/example.png',
				'alt'    => 'example',
				'title'  => 'Example',
				'backup' => array( 'status' => 'uploaded' ),
			);

			public function test_connection( array $settings, $target ) {
				$this->connection_calls[] = array( $settings, $target );

				return $this->connection_result;
			}

			public function upload( array $settings, array $file ) {
				$this->upload_calls[] = array( $settings, $file );

				return $this->upload_result;
			}
		};

		$controller = new ImageHostingController( new Capabilities(), $this->settings_provider, $this->runtime );
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

	public function test_connection_uses_server_only_settings_and_returns_a_redacted_contract() {
		$started_at = time();
		$response = rest_do_request( $this->connection_request( array( 'target' => 'primary' ) ) );
		$finished_at = time();
		$data = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'target'  => 'primary',
				'service' => 'cloudflare-r2',
				'status'  => 'connected',
				'testedAt' => $data['testedAt'],
			),
			$data
		);
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/', $data['testedAt'] );
		$this->assertGreaterThanOrEqual( $started_at, strtotime( $data['testedAt'] ) );
		$this->assertLessThanOrEqual( $finished_at, strtotime( $data['testedAt'] ) );
		$this->assertCount( 1, $this->runtime->connection_calls );
		$this->assertSame( 'synthetic-secret', $this->runtime->connection_calls[0][0]['primary']['secretKey'] );
		$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $data ) );
	}

	public function test_connection_requires_manage_options_and_an_action_nonce() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$forbidden = rest_do_request( $this->connection_request( array( 'target' => 'primary' ) ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$missing_nonce = $this->connection_request( array( 'target' => 'primary' ) );
		$missing_nonce->remove_header( 'X-EasyMDE-Image-Hosting-Nonce' );
		$invalid = rest_do_request( $missing_nonce );

		$this->assertSame( 403, $forbidden->get_status() );
		$this->assertSame( 'easymde_rest_cannot_manage_settings', $forbidden->as_error()->get_error_code() );
		$this->assertSame( 403, $invalid->get_status() );
		$this->assertSame( 'easymde_rest_invalid_image_hosting_nonce', $invalid->as_error()->get_error_code() );
		$this->assertCount( 0, $this->runtime->connection_calls );
	}

	public function test_connection_rejects_unknown_targets_and_extra_fields() {
		$unknown_target = rest_do_request( $this->connection_request( array( 'target' => 'other' ) ) );
		$extra_field    = rest_do_request( $this->connection_request( array( 'target' => 'backup', 'endpoint' => 'https://attacker.example' ) ) );

		$this->assertSame( 400, $unknown_target->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_request', $unknown_target->as_error()->get_error_code() );
		$this->assertSame( 400, $extra_field->get_status() );
		$this->assertSame( 'easymde_image_hosting_invalid_request', $extra_field->as_error()->get_error_code() );
		$this->assertCount( 0, $this->runtime->connection_calls );
	}

	public function test_upload_validates_the_file_and_returns_only_the_stable_browser_contract() {
		$file     = $this->png_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 200, $response->get_status() );
			$this->assertSame(
				array(
					'url'    => 'https://images.example.test/2026/08/example.png',
					'alt'    => 'example',
					'title'  => 'Example',
					'backup' => array( 'status' => 'uploaded' ),
				),
				$response->get_data()
			);
			$this->assertCount( 1, $this->runtime->upload_calls );
			$this->assertSame( 'image.png', $this->runtime->upload_calls[0][1]['name'] );
			$this->assertSame( 'image/png', $this->runtime->upload_calls[0][1]['type'] );
			$this->assertArrayNotHasKey( 'objectKey', $response->get_data() );
			$this->assertStringNotContainsString( 'synthetic-secret', wp_json_encode( $response->get_data() ) );
			$this->assertSame( $this->post_id, $this->runtime->upload_calls[0][1]['post_id'] );
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

	public function test_backup_failure_status_preserves_only_a_stable_code() {
		$this->runtime->upload_result['backup'] = array(
			'status' => 'failed',
			'code'   => 'easymde_image_hosting_backup_upload_failed',
			'raw'    => 'synthetic-secret',
		);
		$file     = $this->png_file();
		$response = rest_do_request( $this->upload_request( $file ) );

		try {
			$this->assertSame( 200, $response->get_status() );
			$this->assertSame(
				array(
					'status' => 'failed',
					'code'   => 'easymde_image_hosting_backup_upload_failed',
				),
				$response->get_data()['backup']
			);
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

	private function connection_request( array $payload ) {
		$request = new WP_REST_Request( 'POST', '/easymde/v1/image-hosting/connection' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_header( 'X-EasyMDE-Image-Hosting-Nonce', wp_create_nonce( ImageHostingController::CONNECTION_NONCE_ACTION ) );
		$request->set_body( wp_json_encode( $payload ) );

		return $request;
	}

	private function upload_request( array $file ) {
		$request = new WP_REST_Request( 'POST', '/easymde/v1/image-hosting/upload' );
		$request->set_header( 'X-EasyMDE-Image-Hosting-Nonce', wp_create_nonce( ImageHostingController::UPLOAD_NONCE_ACTION ) );
		$request->set_param( 'post_id', $this->post_id );
		$request->set_file_params( array( 'file' => $file ) );

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
}
