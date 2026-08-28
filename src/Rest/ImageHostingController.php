<?php

namespace EasyMDE\Rest;

use EasyMDE\ImageHosting\ImageHostDestinationIdentity;
use EasyMDE\ImageHosting\ImageHostProviderSupport;
use EasyMDE\ImageHosting\RemoteImageDownloader;
use EasyMDE\Support\Capabilities;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImageHostingController {

	const VERIFICATION_NONCE_ACTION  = 'easymde_verify_image_hosting_upload';
	const SECRET_REVEAL_NONCE_ACTION = 'easymde_reveal_image_hosting_secret';
	const UPLOAD_NONCE_ACTION        = 'easymde_upload_image_hosting';
	const NONCE_HEADER               = 'X-EasyMDE-Image-Hosting-Nonce';
	const SECRET_NONCE_HEADER        = 'X-EasyMDE-Image-Hosting-Secret-Nonce';
	const MAX_VERIFICATION_BODY      = 8192;
	const MAX_IMPORT_BODY            = 8192;

	private $capabilities;
	private $settings_provider;
	private $runtime;
	private $remote_downloader;

	/**
	 * The settings provider must expose get_image_hosting_settings() and get_image_hosting_secret().
	 * The runtime must expose validate_upload() and upload().
	 */
	public function __construct( Capabilities $capabilities, $settings_provider, $runtime, $remote_downloader = null ) {
		if (
			! is_object( $settings_provider ) ||
			! is_callable( array( $settings_provider, 'get_image_hosting_settings' ) ) ||
			! is_callable( array( $settings_provider, 'get_image_hosting_secret' ) )
		) {
			throw new \InvalidArgumentException( 'The image-hosting settings provider is invalid.' );
		}
		if ( ! is_object( $runtime ) || ! is_callable( array( $runtime, 'validate_upload' ) ) || ! is_callable( array( $runtime, 'upload' ) ) ) {
			throw new \InvalidArgumentException( 'The image-hosting runtime is invalid.' );
		}
		if ( null !== $remote_downloader && ( ! is_object( $remote_downloader ) || ! is_callable( array( $remote_downloader, 'download' ) ) ) ) {
			throw new \InvalidArgumentException( 'The remote image downloader is invalid.' );
		}

		$this->capabilities      = $capabilities;
		$this->settings_provider = $settings_provider;
		$this->runtime           = $runtime;
		$this->remote_downloader = null === $remote_downloader ? new RemoteImageDownloader() : $remote_downloader;
	}

	public function register_routes() {
		register_rest_route(
			'easymde/v1',
			'/image-hosting/verification',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_verification_request' ),
				'permission_callback' => array( $this, 'can_verify_upload' ),
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

		register_rest_route(
			'easymde/v1',
			'/image-hosting/import',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_import_request' ),
				'permission_callback' => array( $this, 'can_import' ),
			)
		);

		register_rest_route(
			'easymde/v1',
			'/image-hosting/secret',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_secret_reveal_request' ),
				'permission_callback' => array( $this, 'can_reveal_secret' ),
			)
		);
	}

	public function can_verify_upload( WP_REST_Request $request ) {
		$capability = $this->capabilities->can_manage_settings( $request );
		if ( is_wp_error( $capability ) ) {
			return $capability;
		}

		if (
			! $this->has_valid_nonce( $request, 'wp_rest', 'X-WP-Nonce' ) ||
			! $this->has_valid_nonce( $request, self::VERIFICATION_NONCE_ACTION )
		) {
			return $this->invalid_nonce_error();
		}

		$content_length = absint( $request->get_header( 'Content-Length' ) );
		if ( $content_length > self::MAX_VERIFICATION_BODY || strlen( (string) $request->get_body() ) > self::MAX_VERIFICATION_BODY ) {
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

	public function can_import( WP_REST_Request $request ) {
		if ( ! $this->has_valid_nonce( $request, 'wp_rest', 'X-WP-Nonce' ) || ! $this->has_valid_nonce( $request, self::UPLOAD_NONCE_ACTION ) ) {
			return $this->invalid_nonce_error();
		}

		$content_length = absint( $request->get_header( 'Content-Length' ) );
		if ( $content_length > self::MAX_IMPORT_BODY || strlen( (string) $request->get_body() ) > self::MAX_IMPORT_BODY ) {
			return new WP_Error(
				'easymde_image_hosting_payload_too_large',
				__( 'The image-hosting request is too large.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		$capability = $this->capabilities->can_upload_media( $request );
		if ( is_wp_error( $capability ) ) {
			return $capability;
		}

		return true;
	}

	public function can_reveal_secret( WP_REST_Request $request ) {
		$capability = $this->capabilities->can_manage_settings( $request );
		if ( is_wp_error( $capability ) ) {
			return $capability;
		}

		if ( ! $this->has_valid_nonce( $request, 'wp_rest', 'X-WP-Nonce' ) ) {
			return $this->invalid_nonce_error();
		}

		return $this->has_valid_nonce( $request, self::SECRET_REVEAL_NONCE_ACTION, self::SECRET_NONCE_HEADER )
			? true
			: $this->invalid_nonce_error();
	}

	public function handle_verification_request( WP_REST_Request $request ) {
		$payload = $request->get_json_params();
		if (
			! is_array( $payload ) ||
			! $this->has_exact_keys( $payload, array( 'target', 'revision', 'settings' ) ) ||
			! in_array( $payload['target'], array( 'primary', 'backup' ), true ) ||
			! is_int( $payload['revision'] ) ||
			$payload['revision'] < 0 ||
			! is_array( $payload['settings'] ) ||
			! $this->is_valid_verification_draft( $payload['settings'] )
		) {
			return $this->invalid_request_error();
		}

		$stored = $this->get_runtime_settings();
		if ( is_wp_error( $stored ) ) {
			return $stored;
		}
		$settings = $this->runtime_settings_from_verification_draft( $payload, $stored );
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

		$result = $this->runtime->validate_upload( $settings, $target );
		if ( is_wp_error( $result ) ) {
			if ( 'easymde_image_hosting_duplicate_destination' === $result->get_error_code() ) {
				return $this->duplicate_destination_error();
			}
			return $this->validation_upload_failed_error();
		}
		if (
			! is_array( $result ) ||
			! $this->has_exact_keys( $result, array( 'status', 'path', 'url' ) ) ||
				'uploaded' !== $result['status'] ||
				! is_string( $result['path'] ) ||
				! ImageHostProviderSupport::is_valid_object_key( $result['path'] )
			) {
				return $this->invalid_runtime_result_error();
		}
			$url          = is_string( $result['url'] ) ? $this->validated_upload_url( $result['url'] ) : '';
			$expected_url = ImageHostProviderSupport::public_url( $settings['primary']['domain'], $result['path'] );
		if ( '' === $url || $expected_url !== $url ) {
			return $this->invalid_runtime_result_error();
		}

		return rest_ensure_response(
			array(
				'target' => $target,
				'status' => 'uploaded',
				'path'   => $result['path'],
				'url'    => $url,
			)
		);
	}

	public function handle_secret_reveal_request( WP_REST_Request $request ) {
		$payload = $request->get_json_params();
		if (
			! is_array( $payload ) ||
			! $this->has_exact_keys( $payload, array( 'target', 'field', 'revision' ) ) ||
			! in_array( $payload['target'], array( 'primary', 'backup' ), true ) ||
			! in_array( $payload['field'], array( 'accessKey', 'secretKey' ), true ) ||
			! is_int( $payload['revision'] ) ||
			$payload['revision'] < 0
		) {
			return $this->invalid_request_error();
		}

		$value = $this->settings_provider->get_image_hosting_secret(
			$payload['target'],
			$payload['field'],
			$payload['revision']
		);
		if ( is_wp_error( $value ) || ! is_string( $value ) || '' === $value || strlen( $value ) > 255 ) {
			return $this->secret_unavailable_error();
		}

		$response = new WP_REST_Response(
			array(
				'target' => $payload['target'],
				'field'  => $payload['field'],
				'value'  => $value,
			)
		);
		$response->header( 'Cache-Control', 'no-store, private' );

		return $response;
	}

	public function handle_upload_request( WP_REST_Request $request ) {
		$file_params = $request->get_file_params();
		$file        = isset( $file_params['file'] ) && is_array( $file_params['file'] ) ? $file_params['file'] : null;
		$settings    = $this->get_runtime_settings();
		if ( is_wp_error( $settings ) ) {
			return $settings;
		}
		$file = $this->validate_file( $file, $settings );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		$file['post_id'] = absint( $request->get_param( 'post_id' ) );

		$result = $this->runtime->upload( $settings, $file );
		if ( is_wp_error( $result ) ) {
			if ( 'easymde_image_hosting_duplicate_destination' === $result->get_error_code() ) {
				return $this->duplicate_destination_error();
			}
			return $this->upload_failed_error();
		}

		return $this->project_upload_result( $result, $settings );
	}

	public function handle_import_request( WP_REST_Request $request ) {
		$payload = $request->get_json_params();
		if (
			! is_array( $payload ) ||
			! $this->has_exact_keys( $payload, array( 'post_id', 'url', 'alt_text' ) ) ||
			! is_int( $payload['post_id'] ) ||
			$payload['post_id'] <= 0 ||
			! is_string( $payload['url'] ) ||
			! is_string( $payload['alt_text'] ) ||
			strlen( $payload['alt_text'] ) > 2048 ||
			1 === preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $payload['alt_text'] )
		) {
			return $this->invalid_request_error();
		}

		$settings = $this->get_runtime_settings();
		if ( is_wp_error( $settings ) ) {
			return $settings;
		}
		$remote_image_upload_mode = isset( $settings['behaviors']['remoteImageUploadMode'] ) && is_string( $settings['behaviors']['remoteImageUploadMode'] )
			? $settings['behaviors']['remoteImageUploadMode']
			: '';
		if ( ! in_array( $remote_image_upload_mode, array( 'both', 'visual', 'source', 'off' ), true ) ) {
			return $this->invalid_runtime_result_error();
		}
		if ( 'off' === $remote_image_upload_mode ) {
			return $this->remote_import_disabled_error();
		}
		if ( $this->is_primary_viewing_domain_url( $payload['url'], $settings ) ) {
			return rest_ensure_response(
				array(
					'status' => 'unchanged',
					'url'    => $payload['url'],
					'alt'    => sanitize_text_field( $payload['alt_text'] ),
					'title'  => $this->unchanged_import_title( $payload['url'], $settings ),
				)
			);
		}
		$maximum_bytes = isset( $settings['behaviors']['maxBytes'] ) && is_int( $settings['behaviors']['maxBytes'] )
			? $settings['behaviors']['maxBytes']
			: 0;
		$file          = $this->remote_downloader->download( $payload['url'], $maximum_bytes );
		if ( is_wp_error( $file ) ) {
			return $this->project_import_download_error( $file );
		}

		$temporary_path = isset( $file['tmp_name'] ) && is_string( $file['tmp_name'] ) ? $file['tmp_name'] : '';
		try {
			$file = $this->validate_file( $file, $settings );
			if ( is_wp_error( $file ) ) {
				return $file;
			}
			$file['post_id'] = $payload['post_id'];

			$result = $this->runtime->upload( $settings, $file );
			if ( is_wp_error( $result ) ) {
				if ( 'easymde_image_hosting_duplicate_destination' === $result->get_error_code() ) {
					return $this->duplicate_destination_error();
				}
				return $this->upload_failed_error();
			}

			$response = $this->project_upload_result( $result, $settings );
			if ( is_wp_error( $response ) ) {
				return $response;
			}
			$data        = $response->get_data();
			$data['alt'] = sanitize_text_field( $payload['alt_text'] );
			$response->set_data( array( 'status' => 'imported' ) + $data );

			return $response;
		} finally {
			if ( '' !== $temporary_path && is_file( $temporary_path ) ) {
				wp_delete_file( $temporary_path );
			}
		}
	}

	private function is_primary_viewing_domain_url( $url, array $settings ) {
		$primary_domain = isset( $settings['primary']['domain'] ) && is_string( $settings['primary']['domain'] )
			? $settings['primary']['domain']
			: '';
		if ( ! $this->is_valid_public_result_url( $primary_domain, false ) ) {
			return false;
		}

		$source_origin  = $this->canonical_import_origin( $url );
		$primary_origin = $this->canonical_import_origin( $primary_domain );

		return '' !== $source_origin && $source_origin === $primary_origin;
	}

	private function canonical_import_origin( $url ) {
		if ( ! is_string( $url ) || '' === $url || strlen( $url ) > 2048 || 1 === preg_match( '/[\x00-\x20\x7F]/', $url ) ) {
			return '';
		}

		$parts = wp_parse_url( $url );
		if (
			! is_array( $parts ) ||
			! isset( $parts['scheme'], $parts['host'] ) ||
			! in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['port'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] ) ||
			esc_url_raw( $url, array( 'http', 'https' ) ) !== $url
		) {
			return '';
		}

		$host = (string) $parts['host'];
		if ( 1 !== preg_match( '/^[A-Za-z0-9.-]+$/D', $host ) || '.' === substr( $host, -1 ) ) {
			return '';
		}

		return strtolower( (string) $parts['scheme'] ) . '://' . strtolower( $host );
	}

	private function unchanged_import_title( $url, array $settings ) {
		$mode = isset( $settings['behaviors']['titleDisplay'] ) && is_string( $settings['behaviors']['titleDisplay'] )
			? $settings['behaviors']['titleDisplay']
			: '';
		if ( 'filename' !== $mode ) {
			return '';
		}

		$parts     = wp_parse_url( $url );
		$path      = is_array( $parts ) && isset( $parts['path'] ) ? rawurldecode( (string) $parts['path'] ) : '';
		$file_name = sanitize_file_name( basename( $path ) );

		return sanitize_text_field( $file_name );
	}

	private function project_import_download_error( WP_Error $error ) {
		$codes = array(
			'easymde_image_hosting_import_invalid_url'     => array( 400, __( 'The remote image URL is invalid.', 'easymde' ) ),
			'easymde_image_hosting_import_empty_file'      => array( 422, __( 'The remote image is empty.', 'easymde' ) ),
			'easymde_image_hosting_import_file_too_large'  => array( 413, __( 'The image is larger than the allowed upload size.', 'easymde' ) ),
			'easymde_image_hosting_import_unsupported_media_type' => array( 415, __( 'This image format is not allowed by the current EasyMDE settings.', 'easymde' ) ),
			'easymde_image_hosting_import_download_failed' => array( 502, __( 'The remote image could not be downloaded.', 'easymde' ) ),
		);
		$code  = $error->get_error_code();
		if ( ! isset( $codes[ $code ] ) ) {
			$code = 'easymde_image_hosting_import_download_failed';
		}

		return new WP_Error(
			$code,
			$codes[ $code ][1],
			array( 'status' => $codes[ $code ][0] )
		);
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
		$base_keys      = array( 'name', 'type', 'tmp_name', 'error', 'size' );
		$full_path_keys = array_merge( $base_keys, array( 'full_path' ) );
		if (
			! is_array( $file ) ||
			( ! $this->has_exact_keys( $file, $base_keys ) && ! $this->has_exact_keys( $file, $full_path_keys ) )
		) {
			return $this->invalid_file_error();
		}
		if ( UPLOAD_ERR_OK !== (int) $file['error'] || ! is_string( $file['tmp_name'] ) || ! is_file( $file['tmp_name'] ) || ! is_readable( $file['tmp_name'] ) ) {
			return $this->invalid_file_error();
		}

		$actual_size   = filesize( $file['tmp_name'] );
		$declared_size = is_int( $file['size'] ) ? $file['size'] : -1;
		$maximum_size  = isset( $settings['behaviors']['maxBytes'] ) && is_int( $settings['behaviors']['maxBytes'] )
			? $settings['behaviors']['maxBytes']
			: 0;
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
		if ( '' === $file_name || ( array_key_exists( 'full_path', $file ) && ! $this->is_valid_full_path_metadata( $file['full_path'], $file_name ) ) ) {
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
		unset( $file['full_path'] );

		return $file;
	}

	private function is_valid_full_path_metadata( $full_path, $file_name ) {
		if (
			! is_string( $full_path ) ||
			'' === $full_path ||
			strlen( $full_path ) > 1024 ||
			'/' === $full_path[0] ||
			false !== strpos( $full_path, '\\' ) ||
			1 === preg_match( '/[\x00-\x1F\x7F]/', $full_path )
		) {
			return false;
		}

		$segments = explode( '/', $full_path );
		foreach ( $segments as $segment ) {
			if ( '' === $segment || '.' === $segment || '..' === $segment ) {
				return false;
			}
		}

		return sanitize_file_name( end( $segments ) ) === $file_name;
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

	private function is_valid_verification_draft( array $draft ) {
		$keys = array( 'service', 'endpoint', 'bucket', 'domain', 'accessKey', 'secretKey', 'fileNameRule', 'uploadRetryCount', 'backupEnabled', 'backupService', 'backupEndpoint', 'backupBucket', 'backupDomain', 'backupAccessKey', 'backupSecretKey', 'compressImages', 'autoUploadPastedImages', 'remoteImageUploadMode', 'maxImageSizeMb', 'uploadFormats', 'titleDisplay' );
		if ( ! $this->has_exact_keys( $draft, $keys ) ) {
			return false;
		}

		foreach ( array( 'backupEnabled', 'compressImages', 'autoUploadPastedImages' ) as $field ) {
			if ( ! is_bool( $draft[ $field ] ) ) {
				return false;
			}
		}
		if ( ! is_string( $draft['remoteImageUploadMode'] ) || ! in_array( $draft['remoteImageUploadMode'], array( 'both', 'visual', 'source', 'off' ), true ) ) {
			return false;
		}
		if ( ! is_int( $draft['uploadRetryCount'] ) || $draft['uploadRetryCount'] < 0 || $draft['uploadRetryCount'] > 5 ) {
			return false;
		}
		if ( ! is_int( $draft['maxImageSizeMb'] ) || $draft['maxImageSizeMb'] < 1 || $draft['maxImageSizeMb'] > 10 ) {
			return false;
		}
		$limits = array(
			'service'         => 32,
			'endpoint'        => 255,
			'bucket'          => 128,
			'domain'          => 255,
			'accessKey'       => 255,
			'secretKey'       => 255,
			'fileNameRule'    => 160,
			'backupService'   => 32,
			'backupEndpoint'  => 255,
			'backupBucket'    => 128,
			'backupDomain'    => 255,
			'backupAccessKey' => 255,
			'backupSecretKey' => 255,
			'titleDisplay'    => 16,
		);
		foreach ( $limits as $field => $limit ) {
			if ( ! is_string( $draft[ $field ] ) || strlen( $draft[ $field ] ) > $limit || 1 === preg_match( '/[\x00-\x1F\x7F]/', $draft[ $field ] ) ) {
				return false;
			}
		}
		if (
			! $this->is_valid_provider_coordinates( $draft['service'], $draft['endpoint'] ) ||
			! $this->is_valid_provider_coordinates( $draft['backupService'], $draft['backupEndpoint'] ) ||
			! $this->is_valid_public_result_url( $draft['domain'], true ) ||
			! $this->is_valid_public_result_url( $draft['backupDomain'], true ) ||
			! in_array( $draft['titleDisplay'], array( 'none', 'filename' ), true ) ||
			! is_array( $draft['uploadFormats'] ) ||
			! $this->has_exact_keys( $draft['uploadFormats'], array( 'jpg', 'png', 'webp', 'gif' ) )
		) {
			return false;
		}
		foreach ( $draft['uploadFormats'] as $enabled ) {
			if ( ! is_bool( $enabled ) ) {
				return false;
			}
		}

		return true;
	}

	private function is_valid_provider_coordinates( $service, $endpoint ) {
		if ( 'qiniu-kodo' === $service ) {
			return '' === $endpoint;
		}

		return in_array( $service, array( 'cloudflare-r2', 'aliyun-oss', 'tencent-cos' ), true ) &&
			( '' === $endpoint || ImageHostProviderSupport::validate_provider_endpoint( $service, $endpoint ) );
	}

	private function runtime_settings_from_verification_draft( array $payload, array $stored ) {
		$draft           = $payload['settings'];
		$target          = $payload['target'];
		$primary         = $this->verification_config_from_draft( $draft, false );
		$backup          = array( 'enabled' => $draft['backupEnabled'] ) + $this->verification_config_from_draft( $draft, true );
		$selected        = 'primary' === $target ? $primary : $backup;
		$stored_selected = isset( $stored[ $target ] ) && is_array( $stored[ $target ] ) ? $stored[ $target ] : array();
		$has_access      = '' !== $selected['accessKey'];
		$has_secret      = '' !== $selected['secretKey'];

		if ( $has_access !== $has_secret ) {
			return $this->draft_credentials_required_error();
		}
		if ( ! $has_access ) {
			$stored_revision = isset( $stored['revision'] ) && is_int( $stored['revision'] ) ? $stored['revision'] : -1;
			if (
				$payload['revision'] !== $stored_revision ||
				! ImageHostDestinationIdentity::are_same( $selected, $stored_selected ) ||
				! isset( $stored_selected['accessKey'], $stored_selected['secretKey'] ) ||
				! ImageHostProviderSupport::validate_credential( $stored_selected['accessKey'] ) ||
				! ImageHostProviderSupport::validate_credential( $stored_selected['secretKey'] )
			) {
				return $this->draft_credentials_required_error();
			}
			$selected['accessKey'] = $stored_selected['accessKey'];
			$selected['secretKey'] = $stored_selected['secretKey'];
		}

		if ( 'primary' === $target ) {
			$primary = $selected;
		} else {
			$backup = array( 'enabled' => $draft['backupEnabled'] ) + $selected;
		}

			return array(
				'primary'      => $primary,
				'backup'       => $backup,
				'fileNameRule' => $draft['fileNameRule'],
			);
	}

	private function verification_config_from_draft( array $draft, $backup ) {
		return array(
			'service'   => $draft[ $backup ? 'backupService' : 'service' ],
			'endpoint'  => $draft[ $backup ? 'backupEndpoint' : 'endpoint' ],
			'bucket'    => $draft[ $backup ? 'backupBucket' : 'bucket' ],
			'domain'    => $draft[ $backup ? 'backupDomain' : 'domain' ],
			'accessKey' => $draft[ $backup ? 'backupAccessKey' : 'accessKey' ],
			'secretKey' => $draft[ $backup ? 'backupSecretKey' : 'secretKey' ],
		);
	}

	private function project_upload_result( $result, array $settings ) {
		if (
			! is_array( $result ) ||
			! $this->has_exact_keys( $result, array( 'url', 'path', 'alt', 'title', 'backup' ) ) ||
			! is_array( $result['backup'] ) ||
			! is_string( $result['path'] ) ||
			! ImageHostProviderSupport::is_valid_object_key( $result['path'] ) ||
			! isset( $settings['primary']['domain'] ) ||
			! is_string( $settings['primary']['domain'] ) ||
			! $this->is_valid_public_result_url( $settings['primary']['domain'], false )
		) {
			return $this->invalid_runtime_result_error();
		}

		$url          = is_string( $result['url'] ) ? $this->validated_upload_url( $result['url'] ) : '';
		$expected_url = ImageHostProviderSupport::public_url( $settings['primary']['domain'], $result['path'] );
		$alt          = is_string( $result['alt'] ) ? sanitize_text_field( $result['alt'] ) : null;
		$title        = is_string( $result['title'] ) ? sanitize_text_field( $result['title'] ) : null;
		$backup       = $this->project_backup_result( $result['backup'] );
		if ( '' === $url || $expected_url !== $url || null === $alt || null === $title || is_wp_error( $backup ) ) {
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

	private function validated_upload_url( $url ) {
		if ( '' === $url || strlen( $url ) > 2048 ) {
			return '';
		}

		$parts = wp_parse_url( $url );
		if (
			! is_array( $parts ) ||
			! in_array( strtolower( isset( $parts['scheme'] ) ? $parts['scheme'] : '' ), array( 'http', 'https' ), true ) ||
			empty( $parts['host'] ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] )
		) {
			return '';
		}

		$sanitized = esc_url_raw( $url, array( 'http', 'https' ) );

		return $sanitized === $url ? $url : '';
	}

	private function project_backup_result( array $backup ) {
		$status = isset( $backup['status'] ) && is_string( $backup['status'] ) ? $backup['status'] : '';
		if ( ! in_array( $status, array( 'disabled', 'uploaded' ), true ) ) {
			return $this->invalid_runtime_result_error();
		}

		return array( 'status' => $status );
	}

	private function is_valid_public_result_url( $value, $allow_empty ) {
		if ( ! is_string( $value ) || ( '' === $value && ! $allow_empty ) ) {
			return false;
		}
		if ( '' === $value ) {
			return true;
		}

		$parts = wp_parse_url( $value );
		return is_array( $parts ) &&
			isset( $parts['scheme'], $parts['host'] ) &&
			in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) &&
			! isset( $parts['user'] ) &&
			! isset( $parts['pass'] ) &&
			! isset( $parts['port'] ) &&
			! isset( $parts['query'] ) &&
			! isset( $parts['fragment'] ) &&
			( ! isset( $parts['path'] ) || '' === $parts['path'] || '/' === $parts['path'] ) &&
			esc_url_raw( $value, array( 'http', 'https' ) ) === $value;
	}

	private function service_for_target( array $settings, $target ) {
		$configuration = isset( $settings[ $target ] ) && is_array( $settings[ $target ] ) ? $settings[ $target ] : array();

		return isset( $configuration['service'] ) && is_string( $configuration['service'] )
			? sanitize_key( $configuration['service'] )
			: '';
	}

	private function has_valid_nonce( WP_REST_Request $request, $action, $header = self::NONCE_HEADER ) {
		$nonce = $request->get_header( $header );

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

	private function remote_import_disabled_error() {
		return new WP_Error(
			'easymde_image_hosting_remote_import_disabled',
			__( 'Remote image import is disabled by the current settings.', 'easymde' ),
			array( 'status' => 409 )
		);
	}

	private function draft_credentials_required_error() {
		return new WP_Error(
			'easymde_image_hosting_draft_credentials_required',
			__( 'Enter both credentials for the changed image-hosting target before testing it.', 'easymde' ),
			array( 'status' => 409 )
		);
	}

	private function invalid_file_error() {
		return new WP_Error(
			'easymde_image_hosting_invalid_file',
			__( 'The image upload is invalid.', 'easymde' ),
			array( 'status' => 400 )
		);
	}

	private function validation_upload_failed_error() {
		return new WP_Error(
			'easymde_image_hosting_validation_upload_failed',
			__( 'The image-hosting validation image could not be uploaded.', 'easymde' ),
			array( 'status' => 502 )
		);
	}

	private function secret_unavailable_error() {
		return new WP_Error(
			'easymde_image_hosting_secret_unavailable',
			__( 'The image-hosting configuration is unavailable.', 'easymde' ),
			array( 'status' => 409 )
		);
	}

	private function duplicate_destination_error() {
		return new WP_Error(
			'easymde_image_hosting_duplicate_destination',
			__( 'The primary and backup image hosts must use different storage destinations.', 'easymde' ),
			array( 'status' => 409 )
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
