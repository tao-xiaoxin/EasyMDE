<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\PostDocument;
use EasyMDE\Support\SettingsCenterRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class EditorMediaUploadPolicy {

	const MEDIA_POST_TYPE_PARAM = 'easymde_post_type';

	private $post_document;
	private $settings_repository;

	public function __construct( PostDocument $post_document, SettingsCenterRepository $settings_repository ) {
		$this->post_document       = $post_document;
		$this->settings_repository = $settings_repository;
	}

	public function register_hooks() {
		add_filter( 'wp_handle_upload_prefilter', array( $this, 'validate_upload' ) );
	}

	public function validate_upload( $file ) {
		if ( ! is_array( $file ) || ! $this->is_supported_post_request() || ! empty( $file['error'] ) ) {
			return $file;
		}

		$name     = isset( $file['name'] ) ? sanitize_file_name( (string) $file['name'] ) : '';
		$tmp_name = isset( $file['tmp_name'] ) && is_string( $file['tmp_name'] ) ? $file['tmp_name'] : '';
		if ( '' === $name || '' === $tmp_name || ! is_file( $tmp_name ) || ! is_readable( $tmp_name ) ) {
			return $file;
		}

		$checked = wp_check_filetype_and_ext( $tmp_name, $name );
		$type    = isset( $checked['type'] ) && is_string( $checked['type'] ) ? $checked['type'] : '';
		if ( 0 !== strpos( $type, 'image/' ) ) {
			return $file;
		}
		if ( ! in_array( $type, $this->settings_repository->get_allowed_image_mime_types(), true ) ) {
			$file['error'] = __( 'This image format is not allowed by the current EasyMDE settings.', 'easymde' );

			return $file;
		}

		$size = filesize( $tmp_name );
		if ( false !== $size && $size > $this->settings_repository->get_effective_image_upload_max_bytes() ) {
			$file['error'] = __( 'The image is larger than the allowed upload size.', 'easymde' );
		}

		return $file;
	}

	private function is_supported_post_request() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- WordPress verifies the media-upload nonce before persistence; this only scopes validation.
		$requested_post_id = isset( $_REQUEST['post_id'] ) ? $_REQUEST['post_id'] : 0;
		if ( ! is_scalar( $requested_post_id ) ) {
			return false;
		}

		$post_id = absint( wp_unslash( $requested_post_id ) );
		if ( $post_id > 0 ) {
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return false;
			}

			$post = get_post( $post_id );

			return $post && $this->post_document->is_supported_post_type( $post->post_type );
		}

		if ( ! $this->is_async_attachment_upload_request() ) {
			return false;
		}

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- WordPress verifies the media-upload nonce before persistence; this only scopes validation.
		$requested_post_type = isset( $_REQUEST[ self::MEDIA_POST_TYPE_PARAM ] )
			? $_REQUEST[ self::MEDIA_POST_TYPE_PARAM ]
			: null;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		if ( ! is_scalar( $requested_post_type ) ) {
			return false;
		}

		$post_type = sanitize_key( (string) wp_unslash( $requested_post_type ) );
		if ( '' === $post_type || ! $this->post_document->is_supported_post_type( $post_type ) ) {
			return false;
		}

		if ( ! current_user_can( 'upload_files' ) || ! current_user_can( $this->create_post_capability( $post_type ) ) ) {
			return false;
		}

		return true;
	}

	private function is_async_attachment_upload_request() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- WordPress verifies the media-upload nonce before persistence; this only scopes validation.
		$requested_action = isset( $_REQUEST['action'] ) ? $_REQUEST['action'] : null;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		if ( ! is_scalar( $requested_action ) ) {
			return false;
		}

		return 'upload-attachment' === sanitize_key( (string) wp_unslash( $requested_action ) );
	}

	private function create_post_capability( $post_type ) {
		$post_type_object = get_post_type_object( $post_type );
		if ( $post_type_object && ! empty( $post_type_object->cap->create_posts ) ) {
			return $post_type_object->cap->create_posts;
		}

		return 'page' === $post_type ? 'edit_pages' : 'edit_posts';
	}
}
