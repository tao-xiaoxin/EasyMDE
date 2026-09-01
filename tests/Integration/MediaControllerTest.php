<?php

use EasyMDE\Rest\MediaController;
use EasyMDE\ImageHosting\ObjectKeyBuilder;
use EasyMDE\Rest\MediaUploadPathScope;
use EasyMDE\Support\Capabilities;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class MediaControllerTest extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_option( Options::EDITOR_SETTINGS );
	}

	public function tear_down() {
		delete_option( Options::EDITOR_SETTINGS );
		parent::tear_down();
	}

	public function test_saved_upload_formats_are_enforced_by_the_media_controller() {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['uploadFormats'] = array(
			'jpg'  => false,
			'png'  => true,
			'webp' => false,
			'gif'  => false,
		);
		$this->assertIsArray( $repository->update_settings( $settings ) );

		$controller = new MediaController( new Capabilities(), $repository, new ObjectKeyBuilder() );
		$reflection = new ReflectionMethod( MediaController::class, 'is_allowed_image_file' );
		$reflection->setAccessible( true );
		$png_path = wp_tempnam( 'allowed.png' );
		$jpg_path = wp_tempnam( 'blocked.jpg' );
		file_put_contents( $png_path, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true ) );
		file_put_contents( $jpg_path, base64_decode( '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', true ) );

		try {
			$this->assertTrue(
				$reflection->invoke( $controller, array( 'name' => 'allowed.png', 'tmp_name' => $png_path ) )
			);
			$this->assertFalse(
				$reflection->invoke( $controller, array( 'name' => 'blocked.jpg', 'tmp_name' => $jpg_path ) )
			);
		} finally {
			unlink( $png_path );
			unlink( $jpg_path );
		}
	}

	public function test_saved_image_size_limit_is_enforced_by_the_media_controller() {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings = $repository->get_settings();
		$settings['images']['maxImageSizeMb'] = 1;
		$this->assertIsArray( $repository->update_settings( $settings ) );
		$path = wp_tempnam( 'oversized.png' );
		file_put_contents( $path, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true ) );
		file_put_contents( $path, str_repeat( "\0", MB_IN_BYTES ), FILE_APPEND );
		$request = new WP_REST_Request( 'POST', '/easymde/v1/media' );
		$request->set_file_params(
			array(
				'file' => array(
					'name'     => 'oversized.png',
					'type'     => 'image/png',
					'tmp_name' => $path,
					'error'    => UPLOAD_ERR_OK,
					'size'     => filesize( $path ),
				),
			)
		);

		try {
			$result = ( new MediaController( new Capabilities(), $repository, new ObjectKeyBuilder() ) )->handle_upload_request( $request );
			$this->assertWPError( $result );
			$this->assertSame( 'easymde_media_file_too_large', $result->get_error_code() );
			$this->assertSame( 413, $result->get_error_data()['status'] );
		} finally {
			unlink( $path );
		}
	}

	public function test_declared_alt_text_is_sanitized_and_used_for_the_attachment_and_response() {
		$path       = $this->png_file();
		$request    = $this->upload_request( $path, "  <strong>Declared</strong> alt\ntext  " );
		$attachment = 0;

		try {
			$response = ( new MediaController(
				new Capabilities(),
				new SettingsCenterRepository( new Options(), new ToolbarRegistry() ),
				new ObjectKeyBuilder()
			) )->handle_upload_request( $request );
			$this->assertNotWPError( $response );

			$data       = $response->get_data();
			$attachment = $data['id'];
			$this->assertSame( 'Declared alt text', $data['alt'] );
			$this->assertSame( 'Declared alt text', get_post_meta( $attachment, '_wp_attachment_image_alt', true ) );
		} finally {
			if ( $attachment ) {
				wp_delete_attachment( $attachment, true );
			}
			if ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
	}

	public function test_empty_declared_alt_text_falls_back_to_the_filename() {
		$path       = $this->png_file();
		$request    = $this->upload_request( $path, " \n " );
		$attachment = 0;

		try {
			$response = ( new MediaController(
				new Capabilities(),
				new SettingsCenterRepository( new Options(), new ToolbarRegistry() ),
				new ObjectKeyBuilder()
			) )->handle_upload_request( $request );
			$this->assertNotWPError( $response );

			$data       = $response->get_data();
			$attachment = $data['id'];
			$this->assertSame( 'fallback image', $data['alt'] );
			$this->assertSame( 'fallback image', get_post_meta( $attachment, '_wp_attachment_image_alt', true ) );
		} finally {
			if ( $attachment ) {
				wp_delete_attachment( $attachment, true );
			}
			if ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
	}

	public function test_saved_file_name_rule_controls_core_media_path_and_metadata_when_hosting_is_disabled()
	{
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$post_id    = self::factory()->post->create();
		$settings['images']['fileNameRule'] = 'easymde-media/{post_id}/{name}.{ext}';
		$this->assertIsArray( $repository->update_settings( $settings ) );
		$path       = $this->png_file();
		$request    = $this->upload_request( $path, '' );
		$request->set_param( 'post_id', $post_id );
		$controller = new MediaController(
			new Capabilities(),
			$repository,
			new ObjectKeyBuilder(),
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
			static function () {
				return '00000000-0000-4000-8000-000000000000';
			}
		);
		$attachment = 0;
		$early_uploads = array();
		$early_check_filter = static function ( $checked, $file, $filename, $mimes, $real_mime ) use ( &$early_uploads ) {
			if ( 'fallback-image.png' === $filename ) {
				$early_uploads[] = wp_upload_dir();
			}

			return $checked;
		};
		$early_override_filter = static function ( $overrides, $file ) use ( &$early_uploads ) {
			if ( is_array( $file ) && isset( $file['name'], $file['tmp_name'] ) && 'fallback-image.png' === $file['name'] ) {
				wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );
				$early_uploads[] = wp_upload_dir();
			}

			return $overrides;
		};
		add_filter( 'wp_check_filetype_and_ext', $early_check_filter, 10, 5 );
		add_filter( 'wp_handle_sideload_overrides', $early_override_filter, 10, 2 );

		try {
			$response = $controller->handle_upload_request( $request );
			$this->assertNotWPError( $response );
			$data       = $response->get_data();
			$attachment = (int) $data['id'];
			$relative   = get_post_meta( $attachment, '_wp_attached_file', true );
			$uploads    = wp_upload_dir();

			$this->assertNotEmpty( $early_uploads );
			foreach ( $early_uploads as $early_upload ) {
				$this->assertStringNotContainsString( '/easymde-media/', $early_upload['path'] );
			}
			$this->assertSame( 'easymde-media/' . $post_id . '/fallback-image.png', $relative );
			$this->assertFileExists( get_attached_file( $attachment ) );
			$this->assertSame( $uploads['baseurl'] . '/' . $relative, $data['url'] );
			$this->assertSame( $data['url'], wp_get_attachment_url( $attachment ) );
			$this->assertSame( 'image/png', get_post( $attachment )->post_mime_type );
			$this->assertSame( $post_id, (int) get_post( $attachment )->post_parent );
			$this->assertIsArray( wp_get_attachment_metadata( $attachment ) );
			$this->assertSame( 'fallback image', $data['alt'] );
			$this->assertSame( 'fallback-image.png', $data['filename'] );
			$this->assertSame( '', $data['title'] );
			$this->assertSame( 'fallback-image', get_post( $attachment )->post_title );
		} finally {
			remove_filter( 'wp_check_filetype_and_ext', $early_check_filter, 10 );
			remove_filter( 'wp_handle_sideload_overrides', $early_override_filter, 10 );
			if ( $attachment ) {
				wp_delete_attachment( $attachment, true );
			}
			if ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
	}

	public function test_core_unique_filename_adds_a_suffix_without_overwriting_a_previous_rule_upload()
	{
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['fileNameRule'] = 'easymde-collision/{name}.{ext}';
		$this->assertIsArray( $repository->update_settings( $settings ) );
		$controller = new MediaController(
			new Capabilities(),
			$repository,
			new ObjectKeyBuilder(),
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
			static function () {
				return '00000000-0000-4000-8000-000000000000';
			}
		);
		$attachments = array();

		try {
			foreach ( array( $this->png_file(), $this->png_file() ) as $path ) {
				$response = $controller->handle_upload_request( $this->upload_request( $path, '' ) );
				$this->assertNotWPError( $response );
				$attachments[] = (int) $response->get_data()['id'];
				if ( file_exists( $path ) ) {
					unlink( $path );
				}
			}

			$first  = get_post_meta( $attachments[0], '_wp_attached_file', true );
			$second = get_post_meta( $attachments[1], '_wp_attached_file', true );
			$this->assertSame( 'easymde-collision/fallback-image.png', $first );
			$this->assertSame( 'easymde-collision/fallback-image-1.png', $second );
			$this->assertFileExists( get_attached_file( $attachments[0] ) );
			$this->assertFileExists( get_attached_file( $attachments[1] ) );
			$this->assertNotSame( wp_get_attachment_url( $attachments[0] ), wp_get_attachment_url( $attachments[1] ) );
		} finally {
			foreach ( $attachments as $attachment ) {
				wp_delete_attachment( $attachment, true );
			}
		}
	}

	public function test_original_name_drives_alt_response_title_and_attachment_title_without_rule_variables_leaking()
	{
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['fileNameRule'] = '{date}/{md5}-{uuid}.{ext}';
		$settings['images']['titleDisplay'] = 'filename';
		$this->assertIsArray( $repository->update_settings( $settings ) );
		$path       = $this->png_file();
		$request    = $this->upload_request_named( $path, '', 'original-asset.png' );
		$hash       = md5( file_get_contents( $path ) );
		$controller = new MediaController(
			new Capabilities(),
			$repository,
			new ObjectKeyBuilder(),
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
			static function () {
				return '00000000-0000-4000-8000-000000000000';
			}
		);
		$attachment = 0;

		try {
			$response   = $controller->handle_upload_request( $request );
			$this->assertNotWPError( $response );
			$data       = $response->get_data();
			$attachment = (int) $data['id'];
			$title      = get_post( $attachment )->post_title;

			$this->assertSame( 'original asset', $data['alt'] );
			$this->assertSame( 'original-asset.png', $data['filename'] );
			$this->assertSame( 'original-asset.png', $data['title'] );
			$this->assertSame( 'original-asset', $title );
			$this->assertStringNotContainsString( $hash, $title );
			$this->assertStringNotContainsString( '00000000-0000-4000-8000-000000000000', $title );
		} finally {
			if ( $attachment ) {
				wp_delete_attachment( $attachment, true );
			}
			if ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
	}

	public function test_filename_rule_clock_and_uuid_failures_return_one_stable_error_without_fallback_attachment()
	{
		$cases = array(
			'clock' => static function () {
				throw new RuntimeException( 'synthetic clock failure' );
			},
			'uuid'  => static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			},
		);

		foreach ( $cases as $case => $clock_or_uuid ) {
			$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
			$settings   = $repository->get_settings();
			$this->assertIsArray( $repository->update_settings( $settings ) );
			$path       = $this->png_file();
			$request    = $this->upload_request( $path, '' );
			$clock      = 'clock' === $case
				? $clock_or_uuid
				: static function () {
					return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
				};
			$uuid = 'uuid' === $case
				? static function () {
					throw new RuntimeException( 'synthetic uuid failure' );
				}
				: static function () {
					return '00000000-0000-4000-8000-000000000000';
				};
			$result = ( new MediaController( new Capabilities(), $repository, new ObjectKeyBuilder(), $clock, $uuid ) )->handle_upload_request( $request );

			$this->assertWPError( $result, $case );
			$this->assertSame( 'easymde_media_filename_rule_failed', $result->get_error_code(), $case );
			$this->assertSame( 500, $result->get_error_data()['status'], $case );
			$this->assertStringNotContainsString( $path, $result->get_error_message(), $case );
			$this->assertSame( 0, (int) wp_count_posts( 'attachment' )->inherit, $case );
			unlink( $path );
		}
	}

	public function test_media_controller_rejects_recursive_use_of_the_same_instance()
	{
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$path       = $this->png_file();
		$request    = $this->upload_request( $path, '' );
		$nested     = null;
		$controller = null;
		$reader     = function ( $file_path, $max_bytes ) use ( &$controller, &$nested, $request ) {
			$nested = $controller->handle_upload_request( $request );

			return file_get_contents( $file_path );
		};
		$controller = new MediaController( new Capabilities(), $repository, new ObjectKeyBuilder(), null, null, $reader );
		$attachment = 0;

		try {
			$response   = $controller->handle_upload_request( $request );
			$this->assertNotWPError( $response );
			$attachment = (int) $response->get_data()['id'];
			$this->assertWPError( $nested );
			$this->assertSame( 'easymde_media_filename_rule_failed', $nested->get_error_code() );
		} finally {
			if ( $attachment ) {
				wp_delete_attachment( $attachment, true );
			}
			if ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
	}

	public function test_successful_core_attachment_is_deleted_when_the_scope_is_not_consumed()
	{
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$path       = $this->png_file();
		$request    = $this->upload_request( $path, '' );
		$attachment_id = 0;
		$attached_file = '';
		$remove_token  = static function ( $file ) use ( $path ) {
			if ( is_array( $file ) && isset( $file['tmp_name'] ) && $path === $file['tmp_name'] ) {
				unset( $file[ MediaUploadPathScope::TOKEN_FIELD ] );
			}

			return $file;
		};
		$capture_deletion = static function ( $post_id ) use ( &$attachment_id, &$attached_file ) {
			$attachment_id = (int) $post_id;
			$attached_file = (string) get_attached_file( $attachment_id );
		};
		add_filter( 'wp_handle_sideload_prefilter', $remove_token, PHP_INT_MAX, 1 );
		add_action( 'delete_attachment', $capture_deletion, PHP_INT_MAX, 1 );
		$controller = new MediaController( new Capabilities(), $repository, new ObjectKeyBuilder() );

		try {
			$result = $controller->handle_upload_request( $request );

			$this->assertWPError( $result );
			$this->assertSame( 'easymde_media_filename_rule_failed', $result->get_error_code() );
			$this->assertGreaterThan( 0, $attachment_id );
			$this->assertNull( get_post( $attachment_id ) );
			$this->assertNotSame( '', $attached_file );
			$this->assertFileDoesNotExist( $attached_file );
		} finally {
			remove_filter( 'wp_handle_sideload_prefilter', $remove_token, PHP_INT_MAX );
			remove_action( 'delete_attachment', $capture_deletion, PHP_INT_MAX );
			if ( file_exists( $path ) ) {
				unlink( $path );
			}
		}
	}

	public function test_media_upload_path_scope_matches_the_tagged_file_and_cleans_all_filters()
	{
		$tmp_name = wp_tempnam( 'scope.png' );
		$scope    = new MediaUploadPathScope( $tmp_name, 'nested/generated.png' );
		$file     = $scope->tag_file(
			array(
				'name'     => 'original.png',
				'type'     => 'image/png',
				'tmp_name' => $tmp_name,
				'error'    => UPLOAD_ERR_OK,
				'size'     => 1,
			)
		);
		$unrelated = $file;
		$unrelated['tmp_name'] = wp_tempnam( 'unrelated.png' );
		$baseline_prefilter      = has_filter( 'wp_handle_sideload_prefilter' );
		$baseline_overrides      = has_filter( 'wp_handle_sideload_overrides' );
		$baseline_check_filetype = has_filter( 'wp_check_filetype_and_ext' );
		$baseline_upload_dir     = has_filter( 'upload_dir' );
		$callback_property       = new ReflectionProperty( MediaUploadPathScope::class, 'prefilter_callback' );
		$callback_property->setAccessible( true );
		$overrides_property = new ReflectionProperty( MediaUploadPathScope::class, 'overrides_callback' );
		$overrides_property->setAccessible( true );
		$check_property     = new ReflectionProperty( MediaUploadPathScope::class, 'check_filetype_callback' );
		$check_property->setAccessible( true );
		$upload_dir_property = new ReflectionProperty( MediaUploadPathScope::class, 'upload_dir_callback' );
		$upload_dir_property->setAccessible( true );
		$callbacks = array();

		try {
			$observed = $scope->run(
				function () use ( $file, $unrelated, $scope, $tmp_name, $callback_property, $overrides_property, $check_property, $upload_dir_property, &$callbacks ) {
					$callbacks['prefilter'] = $callback_property->getValue( $scope );
					$callbacks['overrides'] = $overrides_property->getValue( $scope );
					$callbacks['check_filetype'] = $check_property->getValue( $scope );
					$callbacks['upload_dir'] = $upload_dir_property->getValue( $scope );
					$filtered = apply_filters( 'wp_handle_sideload_prefilter', $file );
					$other    = apply_filters( 'wp_handle_sideload_prefilter', $unrelated );
					apply_filters( 'wp_handle_sideload_overrides', array( 'test_form' => false ), $filtered );
					$checked = apply_filters(
						'wp_check_filetype_and_ext',
						array(
							'ext'             => 'png',
							'type'            => 'image/png',
							'proper_filename' => false,
						),
						$tmp_name,
						'generated.png',
						null,
						'image/png'
					);
					$uploads   = apply_filters(
						'upload_dir',
						array(
							'path'    => '/srv/uploads/2026/07',
							'url'     => 'https://example.test/uploads/2026/07',
							'subdir'  => '/2026/07',
							'basedir' => '/srv/uploads',
							'baseurl' => 'https://example.test/uploads',
							'error'   => false,
						)
					);

					return array( $filtered, $other, $checked, $uploads );
				}
			);

			$this->assertSame( 'generated.png', $observed[0]['name'] );
			$this->assertSame( 'image/png', $observed[0]['type'] );
			$this->assertSame( $tmp_name, $observed[0]['tmp_name'] );
			$this->assertSame( UPLOAD_ERR_OK, $observed[0]['error'] );
			$this->assertSame( 'original.png', $observed[1]['name'] );
			$this->assertSame( 'image/png', $observed[2]['type'] );
			$this->assertSame( '/srv/uploads/nested', $observed[3]['path'] );
			$this->assertSame( 'https://example.test/uploads/nested', $observed[3]['url'] );
			$this->assertSame( '/nested', $observed[3]['subdir'] );
			$this->assertFalse( $observed[3]['error'] );
			$this->assertTrue( $scope->is_consumed() );
			$this->assertTrue( $scope->owns_relative_path( 'nested/generated.png' ) );
			$this->assertFalse( $scope->owns_relative_path( 'generated.png' ) );
		} finally {
			if ( file_exists( $tmp_name ) ) {
				unlink( $tmp_name );
			}
			if ( file_exists( $unrelated['tmp_name'] ) ) {
				unlink( $unrelated['tmp_name'] );
			}
		}

		$this->assertSame( $baseline_prefilter, has_filter( 'wp_handle_sideload_prefilter' ) );
		$this->assertSame( $baseline_overrides, has_filter( 'wp_handle_sideload_overrides' ) );
		$this->assertSame( $baseline_check_filetype, has_filter( 'wp_check_filetype_and_ext' ) );
		$this->assertSame( $baseline_upload_dir, has_filter( 'upload_dir' ) );
		$this->assertFalse( has_filter( 'wp_handle_sideload_prefilter', $callbacks['prefilter'] ) );
		$this->assertFalse( has_filter( 'wp_handle_sideload_overrides', $callbacks['overrides'] ) );
		$this->assertFalse( has_filter( 'wp_check_filetype_and_ext', $callbacks['check_filetype'] ) );
		$this->assertFalse( has_filter( 'upload_dir', $callbacks['upload_dir'] ) );
	}

	public function test_media_upload_path_scope_uses_the_filtered_base_without_a_directory()
	{
		$scope = new MediaUploadPathScope( '/tmp/synthetic-media.png', 'generated.png' );
		$file  = $scope->tag_file(
			array(
				'name'     => 'original.png',
				'type'     => 'image/png',
				'tmp_name' => '/tmp/synthetic-media.png',
				'error'    => UPLOAD_ERR_OK,
			)
		);

		$result = $scope->run(
			function () use ( $file ) {
				$filtered = apply_filters( 'wp_handle_sideload_prefilter', $file );
				apply_filters( 'wp_handle_sideload_overrides', array(), $filtered );
				apply_filters(
					'wp_check_filetype_and_ext',
					array(
						'ext'             => 'png',
						'type'            => 'image/png',
						'proper_filename' => false,
					),
					$filtered['tmp_name'],
					$filtered['name'],
					null,
					'image/png'
				);

				return apply_filters(
					'upload_dir',
					array(
						'path'    => '/srv/uploads/2026/07',
						'url'     => 'https://example.test/uploads/2026/07',
						'subdir'  => '/2026/07',
						'basedir' => '/srv/uploads/',
						'baseurl' => 'https://example.test/uploads/',
						'error'   => 'synthetic-existing-error',
					)
				);
			}
		);

		$this->assertSame( '/srv/uploads', $result['path'] );
		$this->assertSame( 'https://example.test/uploads', $result['url'] );
		$this->assertSame( '', $result['subdir'] );
		$this->assertSame( 'synthetic-existing-error', $result['error'] );
		$this->assertTrue( $scope->owns_relative_path( 'generated.png' ) );
		$this->assertFalse( $scope->owns_relative_path( 'nested/generated.png' ) );
	}

	public function test_media_upload_path_scope_rejects_same_instance_recursion_and_cleans_after_throw()
	{
		$scope              = new MediaUploadPathScope( '/tmp/synthetic-recursive.png', 'recursive.png' );
		$baseline_prefilter = has_filter( 'wp_handle_sideload_prefilter' );
		$baseline_overrides = has_filter( 'wp_handle_sideload_overrides' );
		$baseline_check_filetype = has_filter( 'wp_check_filetype_and_ext' );
		$baseline_upload_dir = has_filter( 'upload_dir' );

		try {
			$scope->run(
				function () use ( $scope ) {
					$scope->run( static function () {} );
				}
			);
			$this->fail( 'Expected recursive scope use to fail.' );
		} catch ( RuntimeException $exception ) {
			$this->assertSame( 'easymde_media_upload_scope_active', $exception->getMessage() );
		}

		$this->assertSame( $baseline_prefilter, has_filter( 'wp_handle_sideload_prefilter' ) );
		$this->assertSame( $baseline_overrides, has_filter( 'wp_handle_sideload_overrides' ) );
		$this->assertSame( $baseline_check_filetype, has_filter( 'wp_check_filetype_and_ext' ) );
		$this->assertSame( $baseline_upload_dir, has_filter( 'upload_dir' ) );
		$this->assertFalse( $scope->is_consumed() );
	}

	public function test_nested_scopes_and_unrelated_upload_dir_calls_do_not_cross_project_paths()
	{
		$scope_a = new MediaUploadPathScope( '/tmp/synthetic-a.png', 'rule-a/generated.png' );
		$scope_b = new MediaUploadPathScope( '/tmp/synthetic-b.png', 'rule-b/generated.png' );
		$file_a  = $scope_a->tag_file( array( 'name' => 'a.png', 'tmp_name' => '/tmp/synthetic-a.png' ) );
		$file_b  = $scope_b->tag_file( array( 'name' => 'b.png', 'tmp_name' => '/tmp/synthetic-b.png' ) );
		$base    = array(
			'path'    => '/srv/uploads/date',
			'url'     => 'https://example.test/uploads/date',
			'subdir'  => '/date',
			'basedir' => '/srv/uploads',
			'baseurl' => 'https://example.test/uploads',
			'error'   => false,
		);

		$result = $scope_a->run(
			function () use ( $scope_a, $scope_b, $file_a, $file_b, $base ) {
				$unrelated = apply_filters( 'upload_dir', $base );
				$filtered_a = apply_filters( 'wp_handle_sideload_prefilter', $file_a );
				apply_filters( 'wp_handle_sideload_overrides', array(), $filtered_a );
				apply_filters(
					'wp_check_filetype_and_ext',
					array( 'ext' => 'png', 'type' => 'image/png', 'proper_filename' => false ),
					$filtered_a['tmp_name'],
					$filtered_a['name'],
					null,
					'image/png'
				);
				$inner = $scope_b->run(
					function () use ( $file_b, $base ) {
						$filtered_b = apply_filters( 'wp_handle_sideload_prefilter', $file_b );
						apply_filters( 'wp_handle_sideload_overrides', array(), $filtered_b );
						apply_filters(
							'wp_check_filetype_and_ext',
							array( 'ext' => 'png', 'type' => 'image/png', 'proper_filename' => false ),
							$filtered_b['tmp_name'],
							$filtered_b['name'],
							null,
							'image/png'
						);

						return apply_filters( 'upload_dir', $base );
					}
				);
				$outer = apply_filters( 'upload_dir', $base );

				return array( $unrelated, $inner, $outer );
			}
		);

		$this->assertSame( '/srv/uploads/date', $result[0]['path'] );
		$this->assertSame( '/srv/uploads/rule-b', $result[1]['path'] );
		$this->assertSame( '/rule-b', $result[1]['subdir'] );
		$this->assertSame( '/srv/uploads/rule-a', $result[2]['path'] );
		$this->assertSame( '/rule-a', $result[2]['subdir'] );
		$this->assertTrue( $scope_a->is_consumed() );
		$this->assertTrue( $scope_b->is_consumed() );
	}

	private function png_file() {
		$path = wp_tempnam( 'fallback-image.png' );
		file_put_contents( $path, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true ) );

		return $path;
	}

	private function upload_request( $path, $alt_text ) {
		return $this->upload_request_named( $path, $alt_text, 'fallback-image.png' );
	}

	private function upload_request_named( $path, $alt_text, $name ) {
		$request = new WP_REST_Request( 'POST', '/easymde/v1/media' );
		$request->set_param( 'alt_text', $alt_text );
		$request->set_file_params(
			array(
				'file' => array(
					'name'     => $name,
					'type'     => 'image/png',
					'tmp_name' => $path,
					'error'    => UPLOAD_ERR_OK,
					'size'     => filesize( $path ),
				),
			)
		);

		return $request;
	}
}
