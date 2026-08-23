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

	public function test_connection_selects_the_requested_provider() {
		$transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 200, '["synthetic-backup"]' ),
			)
		);
		$runtime   = $this->runtime( $transport );
		$settings  = $this->settings();

		$this->assertSame( array( 'status' => 'connected' ), $runtime->test_connection( $settings, 'primary' ) );
		$this->assertSame( array( 'status' => 'connected' ), $runtime->test_connection( $settings, 'backup' ) );
		$this->assertSame( 'HEAD', $transport->requests[0][0] );
		$this->assertSame( 'GET', $transport->requests[1][0] );
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
		$this->assertSame( 'Example Image', $result['alt'] );
		$this->assertSame( '', $result['title'] );
		$this->assertSame( array( 'status' => 'uploaded' ), $result['backup'] );
		$this->assertCount( 2, $transport->requests );
		$this->assertStringContainsString( '/20260713/00000000-0000-4000-8000-000000000000.png', $transport->requests[0][1] );
		$this->assertStringContainsString( '20260713/00000000-0000-4000-8000-000000000000.png', $transport->requests[1][2]['body'] );
		$this->assertArrayNotHasKey( 'key', $result );
	}

	public function test_backup_failure_returns_the_primary_url_and_never_retries() {
		$continue_transport = new ImageHostingRuntimeFakeTransport(
			array(
				HttpResponse::success( 200, '' ),
				HttpResponse::success( 500, 'synthetic provider detail' ),
			)
		);
		$continue_runtime   = $this->runtime( $continue_transport );
		$file               = $this->file( 'image.png', 'image/png', 'source-image-bytes' );
		$result             = $continue_runtime->upload( $this->settings(), $file );

		$this->assertSame(
			array(
				'status' => 'failed',
				'code'   => 'easymde_image_hosting_backup_upload_failed',
			),
			$result['backup']
		);
		$this->assertCount( 2, $continue_transport->requests );

		$abort_transport                       = new ImageHostingRuntimeFakeTransport( array() );
		$abort_settings                        = $this->settings();
		$abort_settings['backup']['failureMode'] = 'abort';
		$abort_result                           = $this->runtime( $abort_transport )->upload( $abort_settings, $file );

		$this->assertWPError( $abort_result );
		$this->assertSame( 'easymde_image_hosting_configuration_invalid', $abort_result->get_error_code() );
		$this->assertCount( 0, $abort_transport->requests );
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
				'service'   => 'cloudflare-r2',
				'accountId' => 'synthetic-account',
				'bucket'    => 'synthetic-primary',
				'domain'    => 'https://images.example.test',
				'accessKey' => 'SYNTHETIC_ACCESS',
				'secretKey' => 'SYNTHETIC_SECRET',
			),
			'backup'      => array(
				'enabled'       => true,
				'service'       => 'qiniu-kodo',
				'bucket'        => 'synthetic-backup',
				'domain'        => 'https://backup.example.test',
				'accessKey'     => 'SYNTHETIC_BACKUP_ACCESS',
				'secretKey'     => 'SYNTHETIC_BACKUP_SECRET',
				'sameObjectKey' => true,
				'failureMode'   => 'continue',
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
