<?php

namespace EasyMDE\Rest;

use EasyMDE\Support\Capabilities;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImageHostingController {

	const CONNECTION_NONCE_ACTION = 'easymde_test_image_hosting';
	const UPLOAD_NONCE_ACTION     = 'easymde_upload_image_hosting';
	const NONCE_HEADER            = 'X-EasyMDE-Image-Hosting-Nonce';
	const MAX_IMAGE_BYTES         = 10485760;
	const MAX_CONNECTION_BODY     = 1024;

	private $capabilities;
	private $settings_provider;
	private $runtime;

	/**
	 * The settings provider must expose get_image_hosting_settings().
	 * The runtime must expose test_connection() and upload().
	 */
	public function __construct( Capabilities $capabilities, $settings_provider, $runtime ) {
		if ( ! is_object( $settings_provider ) || ! is_callable( array( $settings_provider, 'get_image_hosting_settings' ) ) ) {
			throw new \InvalidArgumentException( 'The image-hosting settings provider is invalid.' );
		}
		if ( ! is_object( $runtime ) || ! is_callable( array( $runtime, 'test_connection' ) ) || ! is_callable( array( $runtime, 'upload' ) ) ) {
			throw new \InvalidArgumentException( 'The image-hosting runtime is invalid.' );
		}

		$this->capabilities      = $capabilities;
		$this->settings_provider = $settings_provider;
		$this->runtime           = $runtime;
	}

	public function register_routes() {
		register_rest_route(
			'easymde/v1',
			'/image-hosting/connection',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_connection_request' ),
				'permission_callback' => array( $this, 'can_test_connection' ),
			)
		);

		register_rest_route(
			'easymde/v1',
			'/image-hosting/upload',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_upload_request' ),
				'permission_callback' => array( $this, 'can_upload' ),
				'args'                => array(
					'post_id' => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}

	public function can_test_connection( WP_REST_Request $request ) {
		$capability = $this->capabilities->can_manage_settings( $request );
		if ( is_wp_error( $capability ) ) {
			return $capability;
		}

		if ( ! $this->has_valid_nonce( $request, self::CONNECTION_NONCE_ACTION ) ) {
			return $this->invalid_nonce_error();
		}

		$content_length = absint( $request->get_header( 'Content-Length' ) );
		if ( $content_length > self::MAX_CONNECTION_BODY || strlen( (string) $request->get_body() ) > self::MAX_CONNECTION_BODY ) {
			return new WP_Error(
				'easymde_image_hosting_payload_too_large',
				__( 'The image-hosting request is too large.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		return true;
	}

	public function can_upload( WP_REST_Request $request ) {
		$capability = $this->capabilities->can_upload_media( $request );
		if ( is_wp_error( $capability ) ) {
			return $capability;
		}

		return $this->has_valid_nonce( $request, self::UPLOAD_NONCE_ACTION )
			? true
			: $this->invalid_nonce_error();
	}

	public function handle_connection_request( WP_REST_Request $request ) {
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || ! $this->has_exact_keys( $payload, array( 'target' ) ) || ! in_array( $payload['target'], array( 'primary', 'backup' ), true ) ) {
			return $this->invalid_request_error();
		}

		$settings = $this->get_runtime_settings();
		if ( is_wp_error( $settings ) ) {
			return $settings;
		}

		$target  = $payload['target'];
		$service = $this->service_for_target( $settings, $target );
		if ( '' === $service ) {
			return new WP_Error(
				'easymde_image_hosting_not_configured',
				__( 'The selected image-hosting service is not configured.', 'easymde' ),
				array( 'status' => 409 )
			);
		}

		$result = $this->runtime->test_connection( $settings, $target );
		if ( is_wp_error( $result ) ) {
			return $this->connection_failed_error();
		}
		if ( ! is_array( $result ) || ! isset( $result['status'] ) || 'connected' !== $result['status'] ) {
			return $this->invalid_runtime_result_error();
		}

		return rest_ensure_response(
			array(
				'target'   => $target,
				'service'  => $service,
				'status'   => 'connected',
				'testedAt' => gmdate( 'c' ),
			)
		);
	}

	public function handle_upload_request( WP_REST_Request $request ) {
		$file_params = $request->get_file_params();
		$file        = isset( $file_params['file'] ) && is_array( $file_params['file'] ) ? $file_params['file'] : null;
		$settings    = $this->get_runtime_settings();
		if ( is_wp_error( $settings ) ) {
			return $settings;
		}
		if ( ! isset( $settings['destination'] ) || 'remote' !== $settings['destination'] ) {
			return new WP_Error(
				'easymde_image_hosting_not_enabled',
				__( 'Remote image hosting is not enabled in the current EasyMDE settings.', 'easymde' ),
				array( 'status' => 409 )
			);
		}

		$file = $this->validate_file( $file, $settings );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		$file['post_id'] = absint( $request->get_param( 'post_id' ) );

		$result = $this->runtime->upload( $settings, $file );
		if ( is_wp_error( $result ) ) {
			return $this->upload_failed_error();
		}

		return $this->project_upload_result( $result );
	}

	private function get_runtime_settings() {
		$settings = $this->settings_provider->get_image_hosting_settings();

		return is_array( $settings )
			? $settings
			: new WP_Error(
				'easymde_image_hosting_configuration_unavailable',
				__( 'The image-hosting configuration is unavailable.', 'easymde' ),
				array( 'status' => 500 )
			);
	}

	private function validate_file( $file, array $settings ) {
		if ( ! is_array( $file ) || ! $this->has_exact_keys( $file, array( 'name', 'type', 'tmp_name', 'error', 'size' ) ) ) {
			return $this->invalid_file_error();
		}
		if ( UPLOAD_ERR_OK !== (int) $file['error'] || ! is_string( $file['tmp_name'] ) || ! is_file( $file['tmp_name'] ) || ! is_readable( $file['tmp_name'] ) ) {
			return $this->invalid_file_error();
		}

		$actual_size   = filesize( $file['tmp_name'] );
		$declared_size = is_int( $file['size'] ) ? $file['size'] : -1;
		$maximum_size  = min( self::MAX_IMAGE_BYTES, (int) wp_max_upload_size() );
		if ( false === $actual_size || $actual_size <= 0 || $actual_size !== $declared_size ) {
			return $this->invalid_file_error();
		}
		if ( $actual_size > $maximum_size ) {
			return new WP_Error(
				'easymde_image_hosting_file_too_large',
				__( 'The image is larger than the allowed upload size.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		$file_name = sanitize_file_name( is_string( $file['name'] ) ? $file['name'] : '' );
		if ( '' === $file_name ) {
			return $this->invalid_file_error();
		}

		$checked        = wp_check_filetype_and_ext( $file['tmp_name'], $file_name );
		$type           = isset( $checked['type'] ) && is_string( $checked['type'] ) ? $checked['type'] : '';
		$ext            = isset( $checked['ext'] ) && is_string( $checked['ext'] ) ? strtolower( $checked['ext'] ) : '';
		$declared_type  = is_string( $file['type'] ) ? strtolower( trim( $file['type'] ) ) : '';
		$name_extension = strtolower( pathinfo( $file_name, PATHINFO_EXTENSION ) );
		if (
			'' === $type ||
			$declared_type !== $type ||
			! $this->extension_matches_type( $name_extension, $type ) ||
			0 !== strpos( $type, 'image/' ) ||
			! $this->format_is_allowed( $ext, $settings )
		) {
			return new WP_Error(
				'easymde_image_hosting_unsupported_media_type',
				__( 'This image format is not allowed by the current EasyMDE settings.', 'easymde' ),
				array( 'status' => 415 )
			);
		}

		$file['name'] = $file_name;
		$file['type'] = $type;
		$file['size'] = $actual_size;

		return $file;
	}

	private function extension_matches_type( $extension, $type ) {
		$extensions = array(
			'image/gif'  => array( 'gif' ),
			'image/jpeg' => array( 'jpg', 'jpeg', 'jfif' ),
			'image/png'  => array( 'png' ),
			'image/webp' => array( 'webp' ),
		);

		return isset( $extensions[ $type ] ) && in_array( $extension, $extensions[ $type ], true );
	}

	private function format_is_allowed( $extension, array $settings ) {
		$extension = in_array( $extension, array( 'jpeg', 'jfif' ), true ) ? 'jpg' : $extension;
		$formats   = isset( $settings['behaviors']['uploadFormats'] ) && is_array( $settings['behaviors']['uploadFormats'] )
			? $settings['behaviors']['uploadFormats']
			: array();

		return in_array( $extension, $formats, true );
	}

	private function project_upload_result( $result ) {
		if ( ! is_array( $result ) || ! isset( $result['url'], $result['alt'], $result['title'], $result['backup'] ) || ! is_array( $result['backup'] ) ) {
			return $this->invalid_runtime_result_error();
		}

		$url    = is_string( $result['url'] ) ? esc_url_raw( $result['url'], array( 'https' ) ) : '';
		$alt    = is_string( $result['alt'] ) ? sanitize_text_field( $result['alt'] ) : null;
		$title  = is_string( $result['title'] ) ? sanitize_text_field( $result['title'] ) : null;
		$backup = $this->project_backup_result( $result['backup'] );
		if ( '' === $url || null === $alt || null === $title || is_wp_error( $backup ) ) {
			return $this->invalid_runtime_result_error();
		}

		return rest_ensure_response(
			array(
				'url'    => $url,
				'alt'    => $alt,
				'title'  => $title,
				'backup' => $backup,
			)
		);
	}

	private function project_backup_result( array $backup ) {
		$status = isset( $backup['status'] ) && is_string( $backup['status'] ) ? $backup['status'] : '';
		if ( ! in_array( $status, array( 'disabled', 'uploaded', 'failed' ), true ) ) {
			return $this->invalid_runtime_result_error();
		}

		$projected = array( 'status' => $status );
		if ( 'failed' === $status ) {
			if ( ! isset( $backup['code'] ) || 'easymde_image_hosting_backup_upload_failed' !== $backup['code'] ) {
				return $this->invalid_runtime_result_error();
			}

			$projected['code'] = $backup['code'];
		}

		return $projected;
	}

	private function service_for_target( array $settings, $target ) {
		$configuration = isset( $settings[ $target ] ) && is_array( $settings[ $target ] ) ? $settings[ $target ] : array();

		return isset( $configuration['service'] ) && is_string( $configuration['service'] )
			? sanitize_key( $configuration['service'] )
			: '';
	}

	private function has_valid_nonce( WP_REST_Request $request, $action ) {
		$nonce = $request->get_header( self::NONCE_HEADER );

		return is_string( $nonce ) && '' !== $nonce && wp_verify_nonce( $nonce, $action );
	}

	private function has_exact_keys( array $value, array $keys ) {
		$actual = array_keys( $value );
		sort( $actual );
		sort( $keys );

		return $actual === $keys;
	}

	private function invalid_nonce_error() {
		return new WP_Error(
			'easymde_rest_invalid_image_hosting_nonce',
			__( 'The image-hosting request could not be verified.', 'easymde' ),
			array( 'status' => 403 )
		);
	}

	private function invalid_request_error() {
		return new WP_Error(
			'easymde_image_hosting_invalid_request',
			__( 'The image-hosting request is invalid.', 'easymde' ),
			array( 'status' => 400 )
		);
	}

	private function invalid_file_error() {
		return new WP_Error(
			'easymde_image_hosting_invalid_file',
			__( 'The image upload is invalid.', 'easymde' ),
			array( 'status' => 400 )
		);
	}

	private function connection_failed_error() {
		return new WP_Error(
			'easymde_image_hosting_connection_failed',
			__( 'The image-hosting connection could not be verified.', 'easymde' ),
			array( 'status' => 502 )
		);
	}

	private function upload_failed_error() {
		return new WP_Error(
			'easymde_image_hosting_upload_failed',
			__( 'The image could not be uploaded to the configured image host.', 'easymde' ),
			array( 'status' => 502 )
		);
	}

	private function invalid_runtime_result_error() {
		return new WP_Error(
			'easymde_image_hosting_invalid_runtime_result',
			__( 'The image-hosting service returned an invalid result.', 'easymde' ),
			array( 'status' => 500 )
		);
	}
}
