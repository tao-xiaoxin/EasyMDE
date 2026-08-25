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

		try {
			$filtered = ( new EditorMediaUploadPolicy(
				new PostDocument(),
				new SettingsCenterRepository( new Options(), new ToolbarRegistry() )
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

	private function oversized_png() {
		$path = wp_tempnam( 'oversized.png' );
		file_put_contents( $path, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true ) );
		file_put_contents( $path, str_repeat( "\0", MB_IN_BYTES ), FILE_APPEND );

		return array(
			'name'     => 'oversized.png',
			'type'     => 'image/png',
			'tmp_name' => $path,
			'error'    => UPLOAD_ERR_OK,
			'size'     => filesize( $path ),
		);
	}
}
