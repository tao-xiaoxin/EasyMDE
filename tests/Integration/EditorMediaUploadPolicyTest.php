<?php

use EasyMDE\Admin\EditorMediaUploadPolicy;
use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class EditorMediaUploadPolicyTest extends WP_UnitTestCase {

	private $request;

	public function set_up() {
		parent::set_up();
		$this->request = $_REQUEST;
		delete_option( Options::EDITOR_SETTINGS );
	}

	public function tear_down() {
		$_REQUEST = $this->request;
		delete_option( Options::EDITOR_SETTINGS );
		parent::tear_down();
	}

	public function test_rejects_an_oversized_image_uploaded_for_a_supported_post() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );

		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['maxImageSizeMb'] = 1;
		$this->assertIsArray( $repository->update_settings( $settings ) );

		$_REQUEST['post_id'] = (string) $post_id;
		$file                = $this->oversized_png();

		try {
			$filtered = ( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file );
			$this->assertSame( 'The image is larger than the allowed upload size.', $filtered['error'] );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_rejects_a_disabled_real_image_format_for_a_supported_post() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );

		$repository = $this->repository_with_only_format_enabled( 'png' );
		$_REQUEST['post_id'] = (string) $post_id;
		$file                = $this->image_file( 'blocked.jpg', $this->jpeg_bytes(), 'image/png' );
		$this->assertSame( 'image/jpeg', wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] )['type'] );

		try {
			$filtered = ( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file );
			$this->assertSame( 'This image format is not allowed by the current EasyMDE settings.', $filtered['error'] );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_allows_an_enabled_real_image_format_for_a_supported_post() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );

		$repository = $this->repository_with_only_format_enabled( 'png' );
		$_REQUEST['post_id'] = (string) $post_id;
		$file                = $this->image_file( 'allowed.png', $this->png_bytes(), 'image/jpeg' );
		$this->assertSame( 'image/png', wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] )['type'] );

		try {
			$this->assertSame(
				$file,
				( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file )
			);
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_leaves_uploads_for_unrelated_post_types_unchanged() {
		register_post_type( 'easymde_policy_test', array( 'public' => false ) );
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create(
			array(
				'post_author' => $user_id,
				'post_type'   => 'easymde_policy_test',
			)
		);
		wp_set_current_user( $user_id );
		$_REQUEST['post_id'] = (string) $post_id;
		$file                = $this->oversized_png();
		$repository          = $this->repository_with_only_format_enabled( 'jpg' );

		try {
			$filtered = ( new EditorMediaUploadPolicy(
				new PostDocument(),
				$repository
			) )->validate_upload( $file );
			$this->assertSame( $file, $filtered );
		} finally {
			unlink( $file['tmp_name'] );
			unregister_post_type( 'easymde_policy_test' );
		}
	}

	public function test_leaves_unscoped_and_unauthorized_uploads_unchanged() {
		$author_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id   = self::factory()->post->create( array( 'post_author' => $author_id ) );
		$user_id   = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $user_id );

		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['maxImageSizeMb'] = 1;
		$settings['images']['uploadFormats']['png'] = false;
		$this->assertIsArray( $repository->update_settings( $settings ) );
		$policy = new EditorMediaUploadPolicy( new PostDocument(), $repository );
		$file   = $this->oversized_png();

		try {
			unset( $_REQUEST['post_id'] );
			$this->assertSame( $file, $policy->validate_upload( $file ) );

			$_REQUEST['post_id'] = (string) $post_id;
			$this->assertSame( $file, $policy->validate_upload( $file ) );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_rejects_an_oversized_image_for_an_authorized_new_supported_post_type() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['maxImageSizeMb'] = 1;
		$this->assertIsArray( $repository->update_settings( $settings ) );

		$_REQUEST['action']            = 'upload-attachment';
		$_REQUEST['post_id']           = '0';
		$_REQUEST['easymde_post_type'] = 'post';
		$file                          = $this->oversized_png();

		try {
			$filtered = ( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file );
			$this->assertSame( 'The image is larger than the allowed upload size.', $filtered['error'] );
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_leaves_a_new_upload_unchanged_without_the_media_post_type_param() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		$repository = $this->repository_with_only_format_enabled( 'jpg' );
		$file       = $this->oversized_png();
		$_REQUEST   = array(
			'action'   => 'upload-attachment',
			'post_id'  => '0',
		);

		try {
			$this->assertSame(
				$file,
				( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file )
			);
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_leaves_a_new_upload_unchanged_for_an_unsupported_media_post_type() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		$repository = $this->repository_with_only_format_enabled( 'jpg' );
		$file       = $this->oversized_png();
		$_REQUEST   = array(
			'action'            => 'upload-attachment',
			'post_id'           => '0',
			'easymde_post_type' => 'unsupported',
		);

		try {
			$this->assertSame(
				$file,
				( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file )
			);
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_leaves_a_new_upload_unchanged_for_a_non_scalar_media_post_type_param() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		$repository = $this->repository_with_only_format_enabled( 'jpg' );
		$file       = $this->oversized_png();
		$_REQUEST   = array(
			'action'            => 'upload-attachment',
			'post_id'           => '0',
			'easymde_post_type' => array( 'post' ),
		);

		try {
			$this->assertSame(
				$file,
				( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file )
			);
		} finally {
			unlink( $file['tmp_name'] );
		}
	}

	public function test_leaves_a_new_upload_unchanged_without_the_post_type_create_capability() {
		register_post_type(
			'easymde_policy_book',
			array(
				'capability_type' => 'book',
				'map_meta_cap'    => true,
				'public'          => false,
			)
		);
		$include_book = static function () {
			return array( 'post', 'page', 'easymde_policy_book' );
		};
		add_filter( 'easymde_supported_post_types', $include_book );
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );
		$repository = $this->repository_with_only_format_enabled( 'jpg' );
		$file       = $this->oversized_png();
		$_REQUEST   = array(
			'action'            => 'upload-attachment',
			'post_id'           => '0',
			'easymde_post_type' => 'easymde_policy_book',
		);

		try {
			$this->assertSame(
				$file,
				( new EditorMediaUploadPolicy( new PostDocument(), $repository ) )->validate_upload( $file )
			);
		} finally {
			unlink( $file['tmp_name'] );
			remove_filter( 'easymde_supported_post_types', $include_book );
			unregister_post_type( 'easymde_policy_book' );
		}
	}

	private function oversized_png() {
		$file = $this->image_file( 'oversized.png', $this->png_bytes(), 'image/png' );
		$path = $file['tmp_name'];
		file_put_contents( $path, str_repeat( "\0", MB_IN_BYTES ), FILE_APPEND );
		clearstatcache( true, $path );
		$file['size'] = filesize( $path );

		return $file;
	}

	private function repository_with_only_format_enabled( $enabled_format ) {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['uploadFormats'] = array(
			'jpg'  => 'jpg' === $enabled_format,
			'png'  => 'png' === $enabled_format,
			'webp' => false,
			'gif'  => false,
		);
		$this->assertIsArray( $repository->update_settings( $settings ) );

		return $repository;
	}

	private function image_file( $name, $contents, $declared_type ) {
		$path = wp_tempnam( $name );
		file_put_contents( $path, $contents );

		return array(
			'name'     => $name,
			'type'     => $declared_type,
			'tmp_name' => $path,
			'error'    => UPLOAD_ERR_OK,
			'size'     => filesize( $path ),
		);
	}

	private function png_bytes() {
		return base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true );
	}

	private function jpeg_bytes() {
		return base64_decode( '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', true );
	}
}
