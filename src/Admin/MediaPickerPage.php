<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Asset;
use EasyMDE\Support\ManifestAssetResolver;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MediaPickerPage {

	const ACTION            = 'easymde_media_picker';
	private const SCREEN_ID = 'easymde-media-picker';

	private $post_mode_controller;
	private $post_document;

	public function __construct( PostModeController $post_mode_controller, ?PostDocument $post_document = null ) {
		$this->post_mode_controller = $post_mode_controller;
		$this->post_document        = null !== $post_document ? $post_document : new PostDocument();
	}

	public function register_hooks() {
		add_action( 'admin_post_' . self::ACTION, array( $this, 'render' ) );
	}

	public static function get_url( $post_id, $post_type = '' ) {
		$args = array(
			'action'  => self::ACTION,
			'post_id' => absint( $post_id ),
		);

		$post_type = sanitize_key( (string) $post_type );
		if ( '' !== $post_type ) {
			$args['post_type'] = $post_type;
		}

		return add_query_arg( $args, admin_url( 'admin-post.php' ) );
	}

	public function enqueue_assets_for_request() {
		$target = $this->get_authorized_target();
		try {
			$asset = $this->get_bridge_asset();
		} catch ( \Throwable $error ) {
			wp_trigger_error(
				__METHOD__,
				'EasyMDE media picker bridge asset contract failed (media-picker-bridge-asset-invalid).',
				E_USER_WARNING
			);
			wp_die(
				esc_html__( 'EasyMDE could not load the WordPress media library.', 'easymde' ),
				'',
				array( 'response' => 500 )
			);
		}

		$this->prepare_screen_context();
		$inject_post_type = static function ( $params ) use ( $target ) {
			return self::add_upload_post_type_param( $params, $target['post_type'] );
		};
		add_filter( 'plupload_default_params', $inject_post_type );
		try {
			if ( $target['post_id'] > 0 ) {
				wp_enqueue_media( array( 'post' => $target['post_id'] ) );
			} else {
				wp_enqueue_media();
			}
		} finally {
			remove_filter( 'plupload_default_params', $inject_post_type );
		}
		wp_enqueue_script(
			$asset['handle'],
			Asset::url( $asset['path'] ),
			$asset['dependencies'],
			$asset['version'],
			true
		);

		return $target;
	}

	private static function add_upload_post_type_param( $params, $post_type ) {
		if ( ! is_array( $params ) || array_key_exists( EditorMediaUploadPolicy::MEDIA_POST_TYPE_PARAM, $params ) ) {
			return $params;
		}

		$params[ EditorMediaUploadPolicy::MEDIA_POST_TYPE_PARAM ] = $post_type;

		return $params;
	}

	private function prepare_screen_context() {
		global $hook_suffix;

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Core iframe_header() requires this request-local admin screen context.
		$hook_suffix    = self::SCREEN_ID;
		$current_screen = get_current_screen();
		if ( $current_screen && self::SCREEN_ID === $current_screen->id ) {
			return;
		}

		set_current_screen( self::SCREEN_ID );
	}

	public function render() {
		$this->enqueue_assets_for_request();

		if ( ! function_exists( 'iframe_header' ) ) {
			require_once ABSPATH . 'wp-admin/includes/template.php';
		}

		iframe_header( esc_html__( 'Media Library', 'easymde' ) );
		include Asset::path( 'templates/admin/media-picker-page.php' );
		iframe_footer();
		exit;
	}

	private function get_authorized_target() {
		$post_id   = $this->request_post_id();
		$post_type = $this->request_post_type();
		$post      = $post_id ? get_post( $post_id ) : null;

		if ( $post_id > 0 ) {
			if ( ! $post ) {
				wp_die(
					esc_html__( 'The requested media target is unavailable.', 'easymde' ),
					'',
					array( 'response' => 400 )
				);
			}

			$post_type = sanitize_key( $post->post_type );
			if ( ! $this->post_document->is_supported_post_type( $post_type ) ) {
				wp_die(
					esc_html__( 'The requested post type is not supported by EasyMDE.', 'easymde' ),
					'',
					array( 'response' => 400 )
				);
			}

			if (
				! current_user_can( 'upload_files' )
				|| ! current_user_can( 'edit_post', $post_id )
				|| ! $this->post_mode_controller->is_easymde_editable_post( $post_id, $post_type )
			) {
				wp_die(
					esc_html__( 'You are not allowed to use the media library for this post.', 'easymde' ),
					'',
					array( 'response' => 403 )
				);
			}

			return array(
				'post_id'   => $post_id,
				'post_type' => $post_type,
			);
		}

		if ( '' === $post_type || ! $this->post_document->is_supported_post_type( $post_type ) ) {
			wp_die(
				esc_html__( 'The requested post type is not supported by EasyMDE.', 'easymde' ),
				'',
				array( 'response' => 400 )
			);
		}

		if ( ! current_user_can( 'upload_files' ) || ! current_user_can( $this->create_post_capability( $post_type ) ) ) {
			wp_die(
				esc_html__( 'You are not allowed to use the media library for this post.', 'easymde' ),
				'',
				array( 'response' => 403 )
			);
		}

		return array(
			'post_id'   => 0,
			'post_type' => $post_type,
		);
	}

	private function get_bridge_asset() {
		return ManifestAssetResolver::resolve(
			'frontend/src/entrypoints/media-picker-bridge.ts',
			'assets/build/media-picker/',
			'easymde-media-picker-bridge',
			array( 'media-editor' ),
			'media-picker-bridge',
			true,
			'media-picker-bridge-'
		);
	}

	private function request_post_id() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only iframe admission; mutations use WordPress media nonces.
		return isset( $_GET['post_id'] ) ? absint( wp_unslash( $_GET['post_id'] ) ) : 0;
	}

	private function request_post_type() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only iframe admission; mutations use WordPress media nonces.
		return isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( $_GET['post_type'] ) ) : '';
	}

	private function create_post_capability( $post_type ) {
		$post_type_object = get_post_type_object( $post_type );
		if ( $post_type_object && ! empty( $post_type_object->cap->create_posts ) ) {
			return $post_type_object->cap->create_posts;
		}

		return 'page' === $post_type ? 'edit_pages' : 'edit_posts';
	}
}
