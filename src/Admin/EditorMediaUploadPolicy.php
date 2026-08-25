<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\PostDocument;
use EasyMDE\Support\SettingsCenterRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class EditorMediaUploadPolicy {

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

		$size = filesize( $tmp_name );
		if ( false !== $size && $size > $this->settings_repository->get_effective_image_upload_max_bytes() ) {
			$file['error'] = __( 'The image is larger than the allowed upload size.', 'easymde' );
		}

		return $file;
	}

	private function is_supported_post_request() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- WordPress verifies the media-upload nonce before persistence; this only scopes validation.
		$requested_post_id = isset( $_REQUEST['post_id'] ) ? $_REQUEST['post_id'] : 0;
		$post_id           = is_scalar( $requested_post_id )
			? absint( wp_unslash( $requested_post_id ) )
			: 0;
		if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
			return false;
		}

		$post = get_post( $post_id );

		return $post && $this->post_document->is_supported_post_type( $post->post_type );
	}
}
