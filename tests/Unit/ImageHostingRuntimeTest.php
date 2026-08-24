<?php

use EasyMDE\ImageHosting\HttpResponse;
use EasyMDE\ImageHosting\HttpTransport;
use EasyMDE\ImageHosting\ImageHostingRuntime;

final class ImageHostingRuntimeFakeTransport implements HttpTransport {

	public $requests = array();
	private $responses;

	public function __construct( array $responses ) {
		$this->responses = $responses;
	}

	public function request( $method, $url, array $arguments ) {
		$this->requests[] = array( $method, $url, $arguments );

		return array_shift( $this->responses );
	}
}

class ImageHostingRuntimeFakeEditor {

	public $resize_calls = array();
	public $quality_calls = array();
	public $saved_path = '';

	public function get_size() {
		return array(
			'width'  => 4000,
			'height' => 2000,
		);
	}

	public function resize( $width, $height, $crop ) {
		$this->resize_calls[] = array( $width, $height, $crop );

		return true;
	}

	public function set_quality( $quality ) {
		$this->quality_calls[] = $quality;

		return true;
	}

	public function save( $path, $mime_type ) {
		$extensions       = array(
			'image/jpeg' => 'jpg',
			'image/png'  => 'png',
			'image/webp' => 'webp',
		);
		$this->saved_path = preg_replace( '/\.[^.]+$/', '.' . $extensions[ $mime_type ], $path );
		file_put_contents( $this->saved_path, 'prepared-image-bytes' );

		return array(
			'path'      => $this->saved_path,
			'mime-type' => $mime_type,
		);
	}
}

final class ImageHostingRuntimeThrowingEditor extends ImageHostingRuntimeFakeEditor {

	public $attempted_path = '';

	public function save( $path, $mime_type ) {
		$this->attempted_path = $path;
		throw new RuntimeException( 'Synthetic editor failure.' );
	}
}

final class ImageHostingRuntimeTest extends WP_UnitTestCase {

	private $temporary_files = array();

	public function tear_down() {
		foreach ( $this->temporary_files as $path ) {
			if ( is_file( $path ) ) {
				unlink( $path );
			}
		}

		parent::tear_down();
	}

	public function test_validation_upload_uses_the_current_file_name_rule_for_the_plugin_png() {
		$bytes     = "\x89PNG\r\n\x1a\nsynthetic-icon";
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$runtime   = new ImageHostingRuntime(
			$transport,
			null,
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
			static function () {
				return '00000000-0000-4000-8000-000000000000';
			},
			null,
			static function () use ( $bytes ) {
				return $bytes;
			}
		);
		$settings = $this->settings();
		$settings['fileNameRule'] = '{year}/{month}/{day}/{time}/{post_id}/{md5}-{uuid}-{name}.{ext}';
		$expected_path = '2026/07/13/153045/0/' . md5( $bytes ) . '-00000000-0000-4000-8000-000000000000-easymde-editor-icon.png';

		$result = $runtime->validate_upload( $settings, 'primary' );

		$this->assertSame(
			array(
				'status' => 'uploaded',
				'path'   => $expected_path,
				'url'    => 'https://images.example.test/' . $expected_path,
			),
			$result
		);
		$this->assertCount( 1, $transport->requests );
		$this->assertSame( 'PUT', $transport->requests[0][0] );
		$this->assertSame( $bytes, $transport->requests[0][2]['body'] );
		$this->assertSame( 'image/png', $transport->requests[0][2]['headers']['Content-Type'] );
	}

	public function test_default_validation_image_is_the_committed_plugin_icon() {
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$settings  = $this->settings();
		$settings['backup']['enabled'] = false;
		$icon_path = EASYMDE_PLUGIN_DIR . 'assets/images/easymde-editor-icon.png';
		$icon_bytes = file_get_contents( $icon_path );

		$result = $this->runtime( $transport )->validate_upload( $settings, 'primary' );

		$this->assertIsString( $icon_bytes );
		$this->assertSame( '20260713/00000000-0000-4000-8000-000000000000.png', $result['path'] );
		$this->assertSame( $icon_bytes, $transport->requests[0][2]['body'] );
	}

	public function test_validation_upload_targets_backup_only_and_never_retries_a_failure() {
		$bytes     = "\x89PNG\r\n\x1a\nsynthetic-icon";
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 500, 'synthetic provider detail' ) ) );
		$runtime   = new ImageHostingRuntime(
			$transport,
			null,
			null,
			null,
			null,
			static function () use ( $bytes ) {
				return $bytes;
			}
		);

		$result = $runtime->validate_upload( $this->settings(), 'backup' );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_validation_upload_failed', $result->get_error_code() );
		$this->assertCount( 1, $transport->requests );
		$this->assertSame( 'POST', $transport->requests[0][0] );
	}

	public function test_backup_validation_upload_returns_the_primary_viewing_domain() {
		$bytes     = "\x89PNG\r\n\x1a\nsynthetic-icon";
		$path      = '20260713/00000000-0000-4000-8000-000000000000.png';
		$transport = new ImageHostingRuntimeFakeTransport(
			array( HttpResponse::success( 200, wp_json_encode( array( 'key' => $path ) ) ) )
		);
		$runtime   = new ImageHostingRuntime(
			$transport,
			null,
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
			static function () {
				return '00000000-0000-4000-8000-000000000000';
			},
			null,
			static function () use ( $bytes ) {
				return $bytes;
			}
		);

		$result = $runtime->validate_upload( $this->settings(), 'backup' );

		$this->assertSame(
			array(
				'status' => 'uploaded',
				'path'   => $path,
				'url'    => 'https://images.example.test/' . $path,
			),
			$result
		);
		$this->assertCount( 1, $transport->requests );
		$this->assertSame( 'POST', $transport->requests[0][0] );
	}

	public function test_validation_upload_supports_an_http_primary_viewing_domain() {
		$bytes     = "\x89PNG\r\n\x1a\nsynthetic-icon";
		$path      = '20260713/00000000-0000-4000-8000-000000000000.png';
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$settings  = $this->settings();
		$settings['primary']['domain'] = 'http://images.example.test';

		$result = $this->runtime( $transport )->validate_upload( $settings, 'primary' );

		$this->assertSame( 'http://images.example.test/' . $path, $result['url'] );
		$this->assertCount( 1, $transport->requests );
	}

	public function test_validation_upload_dispatches_all_supported_primary_providers() {
		$bytes = "\x89PNG\r\n\x1a\nsynthetic-icon";
		$path  = '20260713/00000000-0000-4000-8000-000000000000.png';
		$cases = array(
			array('cloudflare-r2', 'https://synthetic-account.r2.cloudflarestorage.com', 'synthetic-primary', HttpResponse::success(200, ''), 'PUT'),
			array('qiniu-kodo', '', 'synthetic-primary', HttpResponse::success(200, wp_json_encode(array('key' => $path))), 'POST'),
			array('aliyun-oss', 'https://oss-cn-hangzhou.aliyuncs.com', 'synthetic-primary', HttpResponse::success(200, ''), 'PUT'),
			array('tencent-cos', 'https://cos.ap-shanghai.myqcloud.com', 'synthetic-primary-1250000000', HttpResponse::success(200, ''), 'PUT'),
		);

		foreach ($cases as $case) {
			$transport = new ImageHostingRuntimeFakeTransport(array($case[3]));
			$settings = $this->settings();
			$settings['backup']['enabled'] = false;
			$settings['primary']['service'] = $case[0];
			$settings['primary']['endpoint'] = $case[1];
			$settings['primary']['bucket'] = $case[2];
			$runtime = new ImageHostingRuntime(
				$transport,
				null,
				static function () {
					return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
				},
				static function () {
					return '00000000-0000-4000-8000-000000000000';
				},
				null,
				static function () use ( $bytes ) {
					return $bytes;
				}
			);

			$result = $runtime->validate_upload($settings, 'primary');
			$this->assertIsArray($result, $case[0]);
			$this->assertSame('uploaded', $result['status'], $case[0]);
			$this->assertSame($case[4], $transport->requests[0][0], $case[0]);
		}
	}

	public function test_duplicate_primary_and_backup_destinations_fail_before_network_requests() {
		$transport = new ImageHostingRuntimeFakeTransport(array());
		$settings = $this->settings();
		$settings['backup']['service'] = 'cloudflare-r2';
		$settings['backup']['endpoint'] = strtoupper($settings['primary']['endpoint']);
		$settings['backup']['bucket'] = strtoupper($settings['primary']['bucket']);
		$settings['backup']['domain'] = 'https://different.example.test';
		$file = $this->file('image.png', 'image/png', 'source-image-bytes');

		$verification = $this->runtime($transport)->validate_upload($settings, 'primary');
		$upload = $this->runtime($transport)->upload($settings, $file);

		$this->assertWPError($verification);
		$this->assertSame('easymde_image_hosting_duplicate_destination', $verification->get_error_code());
		$this->assertSame(409, $verification->get_error_data()['status']);
		$this->assertWPError($upload);
		$this->assertSame('easymde_image_hosting_duplicate_destination', $upload->get_error_code());
		$this->assertSame(409, $upload->get_error_data()['status']);
		$this->assertCount(0, $transport->requests);
	}

	public function test_missing_view_domain_fails_upload_before_network_requests() {
		$transport = new ImageHostingRuntimeFakeTransport(array());
		$settings = $this->settings();
		$settings['backup']['enabled'] = false;
		$settings['primary']['domain'] = '';
		$file = $this->file('image.png', 'image/png', 'source-image-bytes');

		$result = $this->runtime($transport)->upload($settings, $file);

		$this->assertWPError($result);
		$this->assertSame('easymde_image_hosting_configuration_invalid', $result->get_error_code());
		$this->assertCount(0, $transport->requests);
	}

	public function test_upload_writes_primary_then_backup_with_the_same_key() {
		$transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 200, '{"key":"20260713/00000000-0000-4000-8000-000000000000.png"}' ),
			)
		);
		$runtime   = $this->runtime( $transport );
		$file      = $this->file( 'Example Image.png', 'image/png', 'source-image-bytes' );

		$result = $runtime->upload( $this->settings(), $file );

		$this->assertSame( 'https://images.example.test/20260713/00000000-0000-4000-8000-000000000000.png', $result['url'] );
		$this->assertSame( '20260713/00000000-0000-4000-8000-000000000000.png', $result['path'] );
		$this->assertArrayNotHasKey( 'fallbackUrl', $result );
		$this->assertSame( 'Example Image', $result['alt'] );
		$this->assertSame( '', $result['title'] );
		$this->assertSame( array( 'status' => 'uploaded' ), $result['backup'] );
		$this->assertCount( 2, $transport->requests );
		$this->assertStringContainsString( '/20260713/00000000-0000-4000-8000-000000000000.png', $transport->requests[0][1] );
		$this->assertStringContainsString( '20260713/00000000-0000-4000-8000-000000000000.png', $transport->requests[1][2]['body'] );
		$this->assertArrayNotHasKey( 'key', $result );
	}

	public function test_primary_retries_with_the_same_request_until_it_succeeds() {
		$transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 500, 'synthetic primary failure one' ),
				HttpResponse::success( 500, 'synthetic primary failure two' ),
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 500, 'must not be requested after success' ),
			)
		);
		$settings = $this->settings();
		$settings['primary']['retryCount'] = 5;
		$settings['backup']['enabled'] = false;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertIsArray( $result );
		$this->assertCount( 3, $transport->requests );
		$this->assertSame( $transport->requests[0][1], $transport->requests[1][1] );
		$this->assertSame( $transport->requests[1][1], $transport->requests[2][1] );
		$this->assertSame( $transport->requests[0][2]['body'], $transport->requests[1][2]['body'] );
		$this->assertSame( $transport->requests[1][2]['body'], $transport->requests[2][2]['body'] );
	}

	public function test_exhausted_primary_retries_return_the_stable_primary_failure() {
		$transport = new ImageHostingRuntimeFakeTransport( array_fill( 0, 6, HttpResponse::success( 500, 'synthetic primary detail' ) ) );
		$settings = $this->settings();
		$settings['primary']['retryCount'] = 5;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_primary_upload_failed', $result->get_error_code() );
		$this->assertCount( 6, $transport->requests );
		$this->assertStringNotContainsString( 'synthetic primary detail', wp_json_encode( $result ) );
	}

	public function test_backup_failure_with_zero_retries_fails_the_entire_upload_after_one_attempt() {
		$continue_transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 500, 'synthetic provider detail' ),
			)
		);
		$continue_runtime   = $this->runtime( $continue_transport );
		$file               = $this->file( 'image.png', 'image/png', 'source-image-bytes' );
		$result             = $continue_runtime->upload( $this->settings(), $file );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_backup_upload_failed', $result->get_error_code() );
		$this->assertCount( 2, $continue_transport->requests );
	}

	public function test_backup_retries_serially_with_the_same_key_until_it_succeeds() {
		$path = '20260713/00000000-0000-4000-8000-000000000000.png';
		$transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 500, 'synthetic failure one' ),
				HttpResponse::success( 500, 'synthetic failure two' ),
				HttpResponse::success( 200, wp_json_encode( array( 'key' => $path ) ) ),
				HttpResponse::success( 500, 'must not be requested after success' ),
			)
		);
		$settings = $this->settings();
		$settings['backup']['retryCount'] = 3;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertSame( array( 'status' => 'uploaded' ), $result['backup'] );
		$this->assertCount( 4, $transport->requests );
		$this->assertSame( $transport->requests[1][2]['body'], $transport->requests[2][2]['body'] );
		$this->assertSame( $transport->requests[2][2]['body'], $transport->requests[3][2]['body'] );
		foreach ( array_slice( $transport->requests, 1 ) as $request ) {
			$this->assertStringContainsString( $path, $request[2]['body'] );
		}
	}

	public function test_upload_rejects_invalid_retry_counts_before_network_requests() {
		foreach ( array( 'primary', 'backup' ) as $target ) {
			foreach ( array( -1, 6, '2' ) as $invalid ) {
				$transport = new ImageHostingRuntimeFakeTransport( array() );
				$settings = $this->settings();
				$settings[$target]['retryCount'] = $invalid;
				$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

				$result = $this->runtime( $transport )->upload( $settings, $file );

				$this->assertWPError( $result, $target . ':' . gettype( $invalid ) );
				$this->assertSame( 'easymde_image_hosting_configuration_invalid', $result->get_error_code(), $target . ':' . gettype( $invalid ) );
				$this->assertCount( 0, $transport->requests, $target . ':' . gettype( $invalid ) );
			}
		}
	}

	public function test_exhausted_backup_retries_fail_the_entire_upload_with_a_stable_code() {
		$transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 500, 'synthetic provider detail one' ),
				HttpResponse::success( 500, 'synthetic provider detail two' ),
				HttpResponse::success( 500, 'synthetic provider detail three' ),
				HttpResponse::success( 500, 'synthetic provider detail four' ),
			)
		);
		$settings = $this->settings();
		$settings['backup']['retryCount'] = 3;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_backup_upload_failed', $result->get_error_code() );
		$this->assertCount( 5, $transport->requests );
		$this->assertStringNotContainsString( 'synthetic provider detail', wp_json_encode( $result ) );
	}

	public function test_primary_upload_with_zero_retries_does_not_start_backup_after_failure() {
		$transport = new ImageHostingRuntimeFakeTransport(
			array( HttpResponse::success( 500, 'synthetic primary detail' ) )
		);
		$settings = $this->settings();
		$settings['primary']['retryCount'] = 0;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_primary_upload_failed', $result->get_error_code() );
		$this->assertCount( 1, $transport->requests );
	}

	public function test_invalid_backup_configuration_fails_the_entire_upload() {
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );
		foreach ( array( 'missing-credentials', 'unsupported-service' ) as $case ) {
			$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
			$settings  = $this->settings();
			if ( 'missing-credentials' === $case ) {
				unset( $settings['backup']['accessKey'], $settings['backup']['secretKey'] );
			} else {
				$settings['backup']['service'] = 'unsupported-provider';
			}

			$result = $this->runtime( $transport )->upload( $settings, $file );

			$this->assertWPError( $result, $case );
			$this->assertSame( 'easymde_image_hosting_backup_upload_failed', $result->get_error_code(), $case );
			$this->assertCount( 1, $transport->requests, $case );
			$this->assertSame( 'PUT', $transport->requests[0][0], $case );
		}
	}

	public function test_preserve_original_name_still_uses_the_validated_key_builder() {
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$settings  = $this->settings();
		$settings['backup']['enabled'] = false;
		$settings['behaviors']['preserveOriginalName'] = true;
		$settings['behaviors']['altSource'] = 'empty';
		$settings['behaviors']['captionMode'] = 'filename';
		$file    = $this->file( 'Clean Name.png', 'image/png', 'source-image-bytes' );
		$result  = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertStringContainsString( '/20260713/clean-name.png', $transport->requests[0][1] );
		$this->assertSame( '', $result['alt'] );
		$this->assertSame( 'Clean Name', $result['title'] );
		$this->assertSame( array( 'status' => 'disabled' ), $result['backup'] );
		$this->assertArrayNotHasKey( 'fallbackUrl', $result );
	}

	public function test_auto_compress_resizes_non_gif_images_and_removes_owned_temporary_files() {
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$editor    = new ImageHostingRuntimeFakeEditor();
		$runtime   = $this->runtime(
			$transport,
			static function () use ( $editor ) {
				return $editor;
			}
		);
		$settings = $this->settings();
		$settings['backup']['enabled'] = false;
		$settings['behaviors']['autoCompress'] = true;
		$settings['behaviors']['maxImageSize'] = '1920';
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $runtime->upload( $settings, $file );

		$this->assertIsArray( $result );
		$this->assertSame( array( array( 1920, 1920, false ) ), $editor->resize_calls );
		$this->assertSame( array( 82 ), $editor->quality_calls );
		$this->assertNotSame( '', $editor->saved_path );
		$this->assertFileDoesNotExist( $editor->saved_path );
		$this->assertFileExists( $file['tmp_name'] );
		$this->assertSame( 'prepared-image-bytes', $transport->requests[0][2]['body'] );
	}

	public function test_processed_temporary_file_is_removed_when_primary_upload_fails() {
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 500, 'synthetic failure' ) ) );
		$editor    = new ImageHostingRuntimeFakeEditor();
		$runtime   = $this->runtime(
			$transport,
			static function () use ( $editor ) {
				return $editor;
			}
		);
		$settings = $this->settings();
		$settings['behaviors']['autoCompress'] = true;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $runtime->upload( $settings, $file );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_primary_upload_failed', $result->get_error_code() );
		$this->assertFileDoesNotExist( $editor->saved_path );
		$this->assertFileExists( $file['tmp_name'] );
		$this->assertCount( 1, $transport->requests );
	}

	public function test_editor_exception_returns_a_stable_error_and_cleans_the_owned_target() {
		$transport = new ImageHostingRuntimeFakeTransport( array() );
		$editor    = new ImageHostingRuntimeThrowingEditor();
		$runtime   = $this->runtime(
			$transport,
			static function () use ( $editor ) {
				return $editor;
			}
		);
		$settings = $this->settings();
		$settings['behaviors']['autoCompress'] = true;
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $runtime->upload( $settings, $file );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_image_processing_failed', $result->get_error_code() );
		$this->assertNotSame( '', $editor->attempted_path );
		$this->assertFileDoesNotExist( $editor->attempted_path );
		$this->assertFileExists( $file['tmp_name'] );
		$this->assertCount( 0, $transport->requests );
	}

	public function test_upload_text_modes_stay_empty_without_server_received_values() {
		$transport = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$settings  = $this->settings();
		$settings['backup']['enabled'] = false;
		$settings['behaviors']['altSource'] = 'upload';
		$settings['behaviors']['captionMode'] = 'upload';
		$file = $this->file( 'image.png', 'image/png', 'source-image-bytes' );

		$result = $this->runtime( $transport )->upload( $settings, $file );

		$this->assertSame( '', $result['alt'] );
		$this->assertSame( '', $result['title'] );
	}

	public function test_auto_compress_never_rewrites_gif_content() {
		$transport    = new ImageHostingRuntimeFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$factory_used = false;
		$runtime      = $this->runtime(
			$transport,
			static function () use ( &$factory_used ) {
				$factory_used = true;
				return new WP_Error( 'unexpected_editor_use' );
			}
		);
		$settings = $this->settings();
		$settings['backup']['enabled'] = false;
		$settings['behaviors']['autoCompress'] = true;
		$settings['behaviors']['maxImageSize'] = '1920';
		$file = $this->file( 'animated.gif', 'image/gif', 'synthetic-gif-bytes' );

		$result = $runtime->upload( $settings, $file );

		$this->assertIsArray( $result );
		$this->assertFalse( $factory_used );
		$this->assertSame( 'synthetic-gif-bytes', $transport->requests[0][2]['body'] );
	}

	private function runtime( HttpTransport $transport, ?callable $editor_factory = null ) {
		return new ImageHostingRuntime(
			$transport,
			null,
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
			static function () {
				return '00000000-0000-4000-8000-000000000000';
			},
			$editor_factory
		);
	}

	private function settings() {
		return array(
			'primary'     => array(
				'retryCount' => 0,
				'service'   => 'cloudflare-r2',
				'endpoint'  => 'https://synthetic-account.r2.cloudflarestorage.com',
				'bucket'    => 'synthetic-primary',
				'domain'    => 'https://images.example.test',
				'accessKey' => 'SYNTHETIC_ACCESS',
				'secretKey' => 'SYNTHETIC_SECRET',
			),
			'backup'      => array(
				'enabled'       => true,
				'retryCount'    => 0,
				'service'       => 'qiniu-kodo',
				'endpoint'      => '',
				'bucket'        => 'synthetic-backup',
				'domain'        => 'https://backup.example.test',
				'accessKey'     => 'SYNTHETIC_BACKUP_ACCESS',
				'secretKey'     => 'SYNTHETIC_BACKUP_SECRET',
				),
			'fileNameRule' => '{date}/{uuid}.{ext}',
			'behaviors'    => array(
				'autoCompress'         => false,
				'preserveOriginalName' => false,
				'maxImageSize'         => 'original',
				'altSource'            => 'filename',
				'captionMode'          => 'none',
			),
		);
	}

	private function file( $name, $mime_type, $bytes ) {
		$path = wp_tempnam( 'easymde-runtime-test' );
		file_put_contents( $path, $bytes );
		$this->temporary_files[] = $path;

		return array(
			'name'     => sanitize_file_name( $name ),
			'type'     => $mime_type,
			'tmp_name' => $path,
			'error'    => UPLOAD_ERR_OK,
			'size'     => strlen( $bytes ),
		);
	}
}
