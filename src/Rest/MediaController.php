<?php

namespace EasyMDE\Rest;

use DateTimeImmutable;
use DateTimeZone;
use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\ObjectKeyBuilder;
use EasyMDE\Support\Capabilities;
use EasyMDE\Support\SettingsCenterRepository;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;
use Throwable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MediaController {

	private $capabilities;
	private $settings_repository;
	private $key_builder;
	private $clock;
	private $uuid_factory;
	private $file_reader;
	private $active = false;

	public function __construct(
		Capabilities $capabilities,
		SettingsCenterRepository $settings_repository,
		ObjectKeyBuilder $key_builder,
		?callable $clock = null,
		?callable $uuid_factory = null,
		?callable $file_reader = null
	) {
		$this->capabilities        = $capabilities;
		$this->settings_repository = $settings_repository;
		$this->key_builder         = $key_builder;
		$this->clock               = null === $clock
			? static function () {
				return new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
			}
			: $clock;
		$this->uuid_factory        = null === $uuid_factory ? 'wp_generate_uuid4' : $uuid_factory;
		$this->file_reader         = null === $file_reader ? array( $this, 'read_file_bounded' ) : $file_reader;
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
		if ( $this->active ) {
			return $this->filename_rule_error();
		}

		$this->active = true;
		try {
			return $this->handle_upload_request_active( $request );
		} finally {
			$this->active = false;
		}
	}

	private function handle_upload_request_active( WP_REST_Request $request ) {
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
				__( 'The image could not be uploaded.', 'easymde' ),
				array( 'status' => 400 )
			);
		}

		$original_filename = sanitize_file_name( isset( $file['name'] ) ? (string) $file['name'] : 'pasted-image' );
		$file['name']      = $original_filename;
		try {
			$media_settings = $this->settings_repository->get_media_upload_settings();
		} catch ( Throwable $throwable ) {
			return $this->filename_rule_error();
		}
		if (
			! is_array( $media_settings ) ||
			! isset( $media_settings['file_name_rule'], $media_settings['max_bytes'], $media_settings['mime_types'], $media_settings['title_display'] ) ||
			! is_string( $media_settings['file_name_rule'] ) ||
			! is_int( $media_settings['max_bytes'] ) ||
			$media_settings['max_bytes'] <= 0 ||
			! is_array( $media_settings['mime_types'] ) ||
			! is_string( $media_settings['title_display'] )
		) {
			return $this->filename_rule_error();
		}

		$mime_type = $this->verified_mime_type( $file );
		if ( ! in_array( $mime_type, $media_settings['mime_types'], true ) ) {
			return new WP_Error(
				'easymde_unsupported_media_type',
				__( 'This image format is not allowed by the current EasyMDE settings.', 'easymde' ),
				array( 'status' => 415 )
			);
		}
		$file['type'] = $mime_type;

		if ( $this->is_too_large( $file, $media_settings['max_bytes'] ) ) {
			return new WP_Error(
				'easymde_media_file_too_large',
				__( 'The image is larger than the allowed upload size.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		try {
			$bytes = call_user_func( $this->file_reader, $file['tmp_name'], $media_settings['max_bytes'] );
		} catch ( Throwable $throwable ) {
			return $this->filename_rule_error();
		}
		if ( ! is_string( $bytes ) || '' === $bytes ) {
			return $this->filename_rule_error();
		}
		if ( strlen( $bytes ) > $media_settings['max_bytes'] ) {
			return new WP_Error(
				'easymde_media_file_too_large',
				__( 'The image is larger than the allowed upload size.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		try {
			$now = call_user_func( $this->clock );
			if ( ! $now instanceof DateTimeImmutable ) {
				throw new ImageHostException( 'easymde_media_clock_invalid' );
			}
			$key           = $this->key_builder->build(
				$media_settings['file_name_rule'],
				$bytes,
				$original_filename,
				$mime_type,
				absint( $request->get_param( 'post_id' ) ),
				$now->setTimezone( new DateTimeZone( 'UTC' ) ),
				call_user_func( $this->uuid_factory )
			);
			$scope         = new MediaUploadPathScope( $file['tmp_name'], $key );
			$file          = $scope->tag_file( $file );
			$description   = $this->attachment_description( $original_filename );
			$attachment_id = $scope->run(
				function () use ( $file, $description, $request ) {
					return $this->sideload_image( $file, absint( $request->get_param( 'post_id' ) ), $description );
				}
			);
		} catch ( ImageHostException $exception ) {
			return $this->filename_rule_error();
		} catch ( Throwable $throwable ) {
			return $this->filename_rule_error();
		}

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}
		$relative_path = get_post_meta( $attachment_id, '_wp_attached_file', true );
		if ( ! $scope->is_consumed() || ! $scope->owns_relative_path( $relative_path ) ) {
			wp_delete_attachment( $attachment_id, true );

			return $this->filename_rule_error();
		}

		$alt_text = sanitize_text_field( (string) $request->get_param( 'alt_text' ) );
		if ( '' === $alt_text ) {
			$alt_text = $this->default_alt_text( $original_filename );
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
				'filename' => $original_filename,
				'title'    => $this->image_title( $media_settings['title_display'], $original_filename ),
			)
		);
	}

	private function is_allowed_image_file( array $file ) {
		$type = $this->verified_mime_type( $file );

		return in_array( $type, $this->settings_repository->get_allowed_image_mime_types(), true );
	}

	private function is_too_large( array $file, $max_size = null ) {
		$size     = isset( $file['size'] ) ? absint( $file['size'] ) : 0;
		$max_size = null === $max_size ? $this->settings_repository->get_effective_image_upload_max_bytes() : $max_size;

		return $size <= 0 || $size > $max_size;
	}

	private function sideload_image( array $file, $post_id, $description = '' ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$attachment_id = media_handle_sideload( $file, $post_id, $description );
		if ( is_wp_error( $attachment_id ) ) {
			return new WP_Error(
				'easymde_media_upload_failed',
				__( 'The image could not be saved to the WordPress media library.', 'easymde' ),
				array( 'status' => 500 )
			);
		}

		if ( ! wp_attachment_is_image( $attachment_id ) ) {
			wp_delete_attachment( $attachment_id, true );

			return new WP_Error(
				'easymde_unsupported_media_type',
				__( 'This image format is not allowed by the current EasyMDE settings.', 'easymde' ),
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

	private function image_title( $title_display, $file_name ) {
		return 'filename' === $title_display
			? sanitize_text_field( sanitize_file_name( $file_name ) )
			: '';
	}

	private function attachment_description( $file_name ) {
		$stem = pathinfo( sanitize_file_name( $file_name ), PATHINFO_FILENAME );

		return sanitize_text_field( $stem );
	}

	private function verified_mime_type( array $file ) {
		$checked = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );

		return isset( $checked['type'] ) && is_string( $checked['type'] ) ? $checked['type'] : '';
	}

	private function read_file_bounded( $path, $max_bytes ) {
		// Uploads are local temporary files; stream reads keep the byte bound explicit.
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- Reading a bounded temporary upload stream is the operation required before Core sideloading.
		$handle = fopen( $path, 'rb' );
		if ( false === $handle ) {
			return false;
		}

		try {
			return stream_get_contents( $handle, $max_bytes + 1 );
		} finally {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Close the bounded temporary upload stream opened above.
			fclose( $handle );
		}
	}

	private function filename_rule_error() {
		return new WP_Error(
			'easymde_media_filename_rule_failed',
			__( 'The image could not be saved to the WordPress media library.', 'easymde' ),
			array( 'status' => 500 )
		);
	}
}
