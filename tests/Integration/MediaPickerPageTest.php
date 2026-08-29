<?php

use EasyMDE\Admin\MediaPickerPage;
use EasyMDE\Admin\PostModeController;
use EasyMDE\Content\PostDocument;

final class MediaPickerPageTest extends WP_UnitTestCase {

	private $media_picker_page;
	private $previous_get;
	private $previous_screen;
	private $previous_hook_suffix;

	public function set_up() {
		parent::set_up();

		$this->previous_get       = $_GET;
		$this->previous_screen    = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$this->previous_hook_suffix = array_key_exists( 'hook_suffix', $GLOBALS ) ? $GLOBALS['hook_suffix'] : null;
		$post_document            = new PostDocument();
		$this->media_picker_page = new MediaPickerPage( new PostModeController( $post_document ), $post_document );
	}

	public function tear_down() {
		$_GET = $this->previous_get;
		if ( null !== $this->previous_screen ) {
			$GLOBALS['current_screen'] = $this->previous_screen;
		} else {
			unset( $GLOBALS['current_screen'] );
		}
		if ( null !== $this->previous_hook_suffix ) {
			$GLOBALS['hook_suffix'] = $this->previous_hook_suffix;
		} else {
			unset( $GLOBALS['hook_suffix'] );
		}
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_builds_a_same_origin_url_for_existing_and_new_posts() {
		$existing_url = MediaPickerPage::get_url( 42, 'post' );
		$new_url      = MediaPickerPage::get_url( 0, 'page' );

		$this->assertSame(
			admin_url( 'admin-post.php?action=easymde_media_picker&post_id=42&post_type=post' ),
			$existing_url
		);
		$this->assertSame(
			admin_url( 'admin-post.php?action=easymde_media_picker&post_id=0&post_type=page' ),
			$new_url
		);
		$this->assertSame( wp_parse_url( admin_url(), PHP_URL_HOST ), wp_parse_url( $existing_url, PHP_URL_HOST ) );
	}

	public function test_authorizes_an_existing_supported_post_for_the_media_frame() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );
		$_GET = array( 'post_id' => (string) $post_id, 'post_type' => 'post' );

		$this->assertSame(
			array(
				'post_id'   => $post_id,
				'post_type' => 'post',
			),
			$this->resolve_authorized_target()
		);
	}

	public function test_authorizes_a_new_supported_post_using_the_create_capability() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );
		$_GET = array( 'post_id' => '0', 'post_type' => 'post' );

		$this->assertSame(
			array(
				'post_id'   => 0,
				'post_type' => 'post',
			),
			$this->resolve_authorized_target()
		);
	}

	public function test_rejects_an_unsupported_existing_post_type_before_loading_media() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );
		$_GET = array( 'post_id' => (string) $post_id, 'post_type' => 'post' );
		$filter = static function () {
			return array( 'page' );
		};
		add_filter( 'easymde_supported_post_types', $filter );

		try {
			$this->expect_wp_die( 'The requested post type is not supported by EasyMDE.' );
			$this->resolve_authorized_target();
		} finally {
			remove_filter( 'easymde_supported_post_types', $filter );
		}
	}

	public function test_rejects_a_new_post_without_media_or_create_capability() {
		$user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $user_id );
		$_GET = array( 'post_id' => '0', 'post_type' => 'post' );

		$this->expect_wp_die( 'You are not allowed to use the media library for this post.' );
		$this->resolve_authorized_target();
	}

	public function test_prepare_screen_context_creates_the_stable_media_picker_screen() {
		unset( $GLOBALS['current_screen'], $GLOBALS['hook_suffix'] );

		$this->prepare_screen_context();

		$this->assertInstanceOf( WP_Screen::class, get_current_screen() );
		$this->assertSame( 'easymde-media-picker', get_current_screen()->id );
		$this->assertSame( 'easymde-media-picker', $GLOBALS['hook_suffix'] );
	}

	public function test_prepare_screen_context_is_idempotent_for_an_existing_media_picker_screen() {
		set_current_screen( 'easymde-media-picker' );
		$screen = get_current_screen();
		$GLOBALS['hook_suffix'] = 'unexpected-hook';

		$this->prepare_screen_context();

		$this->assertSame( $screen, get_current_screen() );
		$this->assertSame( 'easymde-media-picker', $GLOBALS['hook_suffix'] );
	}

	public function test_prepare_screen_context_replaces_an_unrelated_existing_screen() {
		set_current_screen( 'post' );
		$GLOBALS['hook_suffix'] = 'post.php';

		$this->prepare_screen_context();

		$this->assertSame( 'easymde-media-picker', get_current_screen()->id );
		$this->assertSame( 'easymde-media-picker', $GLOBALS['hook_suffix'] );
	}

	public function test_injects_the_authorized_new_post_type_into_upload_params() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		$_GET = array( 'post_id' => '0', 'post_type' => 'post' );
		$captured = array();
		$record = static function ( $params ) use ( &$captured ) {
			$captured = $params;

			return $params;
		};
		add_filter( 'plupload_default_params', $record, 20 );

		try {
			$this->media_picker_page->enqueue_assets_for_request();
		} finally {
			remove_filter( 'plupload_default_params', $record, 20 );
		}

		$this->assertSame( 'upload-attachment', $captured['action'] );
		$this->assertSame( 'post', $captured['easymde_post_type'] );
	}

	public function test_does_not_overwrite_existing_upload_params() {
		$reflection = new ReflectionMethod( MediaPickerPage::class, 'add_upload_post_type_param' );
		$reflection->setAccessible( true );
		$params = array(
			'action'                         => 'existing-action',
			'easymde_post_type'              => 'existing-type',
			'_wpnonce'                       => 'existing-nonce',
		);

		$this->assertSame( $params, $reflection->invoke( null, $params, 'post' ) );
	}

	private function resolve_authorized_target() {
		$reflection = new ReflectionMethod( MediaPickerPage::class, 'get_authorized_target' );
		$reflection->setAccessible( true );

		return $reflection->invoke( $this->media_picker_page );
	}

	private function prepare_screen_context() {
		$reflection = new ReflectionMethod( MediaPickerPage::class, 'prepare_screen_context' );
		$reflection->setAccessible( true );
		$reflection->invoke( $this->media_picker_page );
	}

	private function expect_wp_die( $message ) {
		add_filter( 'wp_die_handler', array( $this, 'media_picker_wp_die_handler' ) );
		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( $message );
	}

	public function media_picker_wp_die_handler() {
		return array( $this, 'throw_wp_die_exception' );
	}

	public function throw_wp_die_exception( $message ) {
		remove_filter( 'wp_die_handler', array( $this, 'media_picker_wp_die_handler' ) );
		throw new RuntimeException( wp_strip_all_tags( (string) $message ) );
	}
}
