<?php

namespace EasyMDE\Rest;

use EasyMDE\Support\Capabilities;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MediaController {

	const MAX_IMAGE_BYTES = 10485760;

	private $capabilities;

	public function __construct( Capabilities $capabilities ) {
		$this->capabilities = $capabilities;
	}

	public function register_routes() {
		register_rest_route(
			'easymde/v1',
			'/media',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_upload_request' ),
				'permission_callback' => array( $this->capabilities, 'can_upload_media' ),
				'args'                => array(
					'post_id'  => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
					),
					'alt_text' => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);
	}

	public function handle_upload_request( WP_REST_Request $request ) {
		$file_params = $request->get_file_params();
		$file        = isset( $file_params['file'] ) && is_array( $file_params['file'] ) ? $file_params['file'] : null;

		if ( ! $file || empty( $file['tmp_name'] ) ) {
			return new WP_Error(
				'easymde_missing_media_file',
				__( 'No image file was provided for upload.', 'easymde' ),
				array( 'status' => 400 )
			);
		}

		$upload_error = isset( $file['error'] ) ? (int) $file['error'] : UPLOAD_ERR_OK;
		if ( UPLOAD_ERR_OK !== $upload_error ) {
			return new WP_Error(
				'easymde_media_upload_error',
				__( 'The pasted image could not be uploaded.', 'easymde' ),
				array( 'status' => 400 )
			);
		}

		$file['name'] = sanitize_file_name( isset( $file['name'] ) ? (string) $file['name'] : 'pasted-image' );

		if ( ! $this->is_allowed_image_file( $file ) ) {
			return new WP_Error(
				'easymde_unsupported_media_type',
				__( 'Only JPEG, PNG, GIF, or WebP images can be pasted into EasyMDE.', 'easymde' ),
				array( 'status' => 415 )
			);
		}

		if ( $this->is_too_large( $file ) ) {
			return new WP_Error(
				'easymde_media_file_too_large',
				__( 'The pasted image is larger than the allowed upload size.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		$attachment_id = $this->sideload_image( $file, absint( $request->get_param( 'post_id' ) ) );
		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		$alt_text = sanitize_text_field( (string) $request->get_param( 'alt_text' ) );
		if ( '' === $alt_text ) {
			$alt_text = $this->default_alt_text( $file['name'] );
		}

		if ( '' !== $alt_text ) {
			update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt_text );
		}

		$url = wp_get_attachment_url( $attachment_id );
		if ( ! $url ) {
			return new WP_Error(
				'easymde_media_url_unavailable',
				__( 'The uploaded image URL is unavailable.', 'easymde' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'       => $attachment_id,
				'url'      => $url,
				'alt'      => $alt_text,
				'filename' => $file['name'],
			)
		);
	}

	private function is_allowed_image_file( array $file ) {
		$checked = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );
		$type    = isset( $checked['type'] ) ? $checked['type'] : '';

		return in_array(
			$type,
			array(
				'image/jpeg',
				'image/png',
				'image/gif',
				'image/webp',
			),
			true
		);
	}

	private function is_too_large( array $file ) {
		$size     = isset( $file['size'] ) ? absint( $file['size'] ) : 0;
		$max_size = min( self::MAX_IMAGE_BYTES, (int) wp_max_upload_size() );

		return $size <= 0 || $size > $max_size;
	}

	private function sideload_image( array $file, $post_id ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$attachment_id = media_handle_sideload( $file, $post_id );
		if ( is_wp_error( $attachment_id ) ) {
			return new WP_Error(
				'easymde_media_upload_failed',
				__( 'The pasted image could not be saved to the WordPress media library.', 'easymde' ),
				array( 'status' => 500 )
			);
		}

		if ( ! wp_attachment_is_image( $attachment_id ) ) {
			wp_delete_attachment( $attachment_id, true );

			return new WP_Error(
				'easymde_unsupported_media_type',
				__( 'Only JPEG, PNG, GIF, or WebP images can be pasted into EasyMDE.', 'easymde' ),
				array( 'status' => 415 )
			);
		}

		return $attachment_id;
	}

	private function default_alt_text( $file_name ) {
		$name = preg_replace( '/\.[^.]+$/', '', (string) $file_name );
		$name = str_replace( array( '-', '_' ), ' ', $name );

		return trim( sanitize_text_field( $name ) );
	}
}
