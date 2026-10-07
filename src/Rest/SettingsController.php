<?php

namespace EasyMDE\Rest;

use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\ImageHostProviderSupport;
use EasyMDE\ImageHosting\ImageUploadExtensionPolicy;
use EasyMDE\ImageHosting\ObjectKeyBuilder;
use EasyMDE\Support\Capabilities;
use EasyMDE\Support\SettingsCenterRepository;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsController {

	const MAX_UPDATE_BODY_BYTES = 65536;
	const UPDATE_NONCE_ACTION   = 'easymde_update_settings';

	private $capabilities;
	private $settings_repository;

	public function __construct( Capabilities $capabilities, SettingsCenterRepository $settings_repository ) {
		$this->capabilities        = $capabilities;
		$this->settings_repository = $settings_repository;
	}

	public function register_routes() {
		register_rest_route(
			'easymde/v1',
			'/settings',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'handle_get_request' ),
				'permission_callback' => array( $this->capabilities, 'can_manage_settings' ),
			)
		);

		register_rest_route(
			'easymde/v1',
			'/settings',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_update_request' ),
				'permission_callback' => array( $this, 'can_update_settings' ),
				'args'                => array(
					// Validation happens in the callback so the endpoint can return its
					// stable domain error codes instead of REST's generic param error.
					'settings'     => array(),
					'resetSecrets' => array(),
				),
			)
		);
	}

	public function handle_get_request( WP_REST_Request $request ) {
		unset( $request );

		try {
			return rest_ensure_response( $this->settings_repository->get_settings_response() );
		} catch ( \RuntimeException $exception ) {
			if ( SettingsCenterRepository::CONFIGURATION_ERROR_CODE !== $exception->getMessage() ) {
				throw $exception;
			}

			return $this->settings_configuration_error();
		}
	}

	public function handle_update_request( WP_REST_Request $request ) {
		$settings = $request->get_param( 'settings' );
		$legacy   = $this->legacy_settings_payload_kind( $settings );
		$valid    = $this->validate_settings_payload( $settings );
		if ( true !== $valid ) {
			return $valid;
		}

		$reset = $request->get_param( 'resetSecrets' );
		if ( null === $reset ) {
			$reset = false;
		}
		$valid_reset = $this->validate_reset_secrets( $reset );
		if ( true !== $valid_reset ) {
			return $valid_reset;
		}

		try {
			$result = $this->settings_repository->update_settings_response( $settings, $reset );
		} catch ( \RuntimeException $exception ) {
			if ( SettingsCenterRepository::CONFIGURATION_ERROR_CODE !== $exception->getMessage() ) {
				throw $exception;
			}

			return $this->settings_configuration_error();
		}
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( false !== $legacy ) {
			$result = $this->project_legacy_settings_response( $result, 'split' === $legacy );
		}

		return rest_ensure_response( $result );
	}

	public function can_update_settings( WP_REST_Request $request ) {
		$capability = $this->capabilities->can_manage_settings( $request );
		if ( is_wp_error( $capability ) ) {
			return $capability;
		}

		if ( ! $this->has_valid_update_nonce( $request ) ) {
			return new WP_Error(
				'easymde_rest_invalid_settings_nonce',
				__( 'The settings request could not be verified.', 'easymde' ),
				array( 'status' => 403 )
			);
		}

		if ( $this->update_request_is_too_large( $request ) ) {
			return new WP_Error(
				'easymde_settings_payload_too_large',
				__( 'The settings payload is too large.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		return true;
	}

	public function validate_reset_secrets( $value ) {
		return is_bool( $value )
			? true
			: new WP_Error(
				'easymde_settings_invalid_payload',
				__( 'The settings payload is invalid.', 'easymde' ),
				array( 'status' => 400 )
			);
	}

	public function validate_settings_payload( $value ) {
		if ( ! is_array( $value ) ) {
			return $this->invalid_payload_error();
		}
		$value = $this->normalize_legacy_image_payload( $value );

		$shapes = array(
			'settings'  => array( 'revision', 'general', 'images', 'markdown', 'shortcuts' ),
			'general'   => array( 'interfaceLanguage', 'editingMode', 'showLineNumbers', 'statusBarMode', 'autoSave', 'autoSaveInterval', 'syncScroll', 'publishVisibility', 'openPreviewAfterPublish', 'applyEditorThemeToFrontend', 'showPublishedCodeCopyButton', 'summaryMode' ),
			'images'    => array( 'imageHostingEnabled', 'wechatPngExportEnabled', 'service', 'endpoint', 'bucket', 'domain', 'accessKey', 'secretKey', 'storagePath', 'fileNameRule', 'uploadRetryCount', 'backupEnabled', 'backupService', 'backupEndpoint', 'backupBucket', 'backupDomain', 'backupAccessKey', 'backupSecretKey', 'compressImages', 'autoUploadPastedImages', 'remoteImageUploadMode', 'maxImageSizeMb', 'uploadFormats', 'titleDisplay' ),
			'markdown'  => array( 'wordWrap', 'githubFlavor', 'smartPunctuation', 'tableAlignment', 'codeLineNumbers', 'pasteAsMarkdown' ),
			'shortcuts' => array( 'values' ),
		);

		if ( ! $this->has_exact_keys( $value, $shapes['settings'] ) || ! is_int( $value['revision'] ) || $value['revision'] < 0 ) {
			return $this->invalid_payload_error();
		}

		foreach ( array( 'general', 'images', 'markdown', 'shortcuts' ) as $section ) {
			if ( ! is_array( $value[ $section ] ) || ! $this->has_exact_keys( $value[ $section ], $shapes[ $section ] ) ) {
				return $this->invalid_payload_error();
			}
		}

		$string_fields  = array(
			'general'  => array(
				'interfaceLanguage' => 16,
				'editingMode'       => 16,
				'statusBarMode'     => 32,
				'autoSaveInterval'  => 8,
				'publishVisibility' => 16,
				'summaryMode'       => 16,
			),
			'images'   => array(
				'service'               => 32,
				'endpoint'              => 255,
				'bucket'                => 128,
				'domain'                => 255,
				'accessKey'             => 255,
				'secretKey'             => 255,
				'storagePath'           => 160,
				'fileNameRule'          => 160,
				'backupService'         => 32,
				'backupEndpoint'        => 255,
				'backupBucket'          => 128,
				'backupDomain'          => 255,
				'backupAccessKey'       => 255,
				'backupSecretKey'       => 255,
				'remoteImageUploadMode' => 16,
				'titleDisplay'          => 16,
			),
			'markdown' => array(
				'tableAlignment'  => 16,
				'codeLineNumbers' => 16,
			),
		);
		$boolean_fields = array(
			'general'  => array( 'showLineNumbers', 'autoSave', 'syncScroll', 'openPreviewAfterPublish', 'applyEditorThemeToFrontend', 'showPublishedCodeCopyButton' ),
			'images'   => array( 'imageHostingEnabled', 'wechatPngExportEnabled', 'backupEnabled', 'compressImages', 'autoUploadPastedImages' ),
			'markdown' => array( 'wordWrap', 'githubFlavor', 'smartPunctuation', 'pasteAsMarkdown' ),
		);

		foreach ( $string_fields as $section => $fields ) {
			foreach ( $fields as $field => $maximum_length ) {
				if ( ! is_string( $value[ $section ][ $field ] ) || strlen( $value[ $section ][ $field ] ) > $maximum_length ) {
					return $this->invalid_payload_error();
				}
			}
		}
		foreach ( $boolean_fields as $section => $fields ) {
			foreach ( $fields as $field ) {
				if ( ! is_bool( $value[ $section ][ $field ] ) ) {
					return $this->invalid_payload_error();
				}
			}
		}
		foreach ( array( 'uploadRetryCount' ) as $retry_field ) {
			if (
				! is_int( $value['images'][ $retry_field ] ) ||
				$value['images'][ $retry_field ] < 0 ||
				$value['images'][ $retry_field ] > 5
			) {
				return $this->invalid_payload_error();
			}
		}
		if ( ! is_int( $value['images']['maxImageSizeMb'] ) || $value['images']['maxImageSizeMb'] < 1 || $value['images']['maxImageSizeMb'] > 10 ) {
			return $this->invalid_payload_error();
		}

		if ( ! is_array( $value['images']['uploadFormats'] ) || ! $this->has_exact_keys( $value['images']['uploadFormats'], ImageUploadExtensionPolicy::extensions() ) ) {
			return $this->invalid_payload_error();
		}
		foreach ( $value['images']['uploadFormats'] as $enabled ) {
			if ( ! is_bool( $enabled ) ) {
				return $this->invalid_payload_error();
			}
		}
		if ( ! in_array( true, $value['images']['uploadFormats'], true ) ) {
			return $this->invalid_payload_error();
		}

		$shortcut_ids = array( 'save', 'bold', 'italic', 'strikethrough', 'paragraph', 'heading-one', 'heading-two', 'heading-three', 'heading-four', 'heading-five', 'heading-six', 'quote', 'unordered-list', 'ordered-list', 'inline-code', 'code-fence', 'math-block', 'link', 'image' );
		if ( ! is_array( $value['shortcuts']['values'] ) || ! $this->has_exact_keys( $value['shortcuts']['values'], $shortcut_ids ) ) {
			return $this->invalid_payload_error();
		}
		foreach ( $value['shortcuts']['values'] as $shortcut ) {
			if ( ! is_array( $shortcut ) || ! $this->has_exact_keys( $shortcut, array( 'windows', 'mac' ) ) ) {
				return $this->invalid_payload_error();
			}
			foreach ( $shortcut as $platform_value ) {
				if ( ! is_string( $platform_value ) || strlen( $platform_value ) > 64 ) {
					return $this->invalid_payload_error();
				}
			}
		}

		$enums = array(
			'general'  => array(
				'interfaceLanguage' => array( 'zh-CN', 'zh-TW', 'en-US' ),
				'editingMode'       => array( 'live-preview', 'source', 'preview' ),
				'statusBarMode'     => array( 'detailed', 'compact', 'hidden' ),
				'autoSaveInterval'  => array( '5', '30', '60', '120', '300' ),
				'publishVisibility' => array( 'public', 'private', 'password' ),
				'summaryMode'       => array( 'auto-55', 'auto-100', 'manual' ),
			),
			'images'   => array(
				'service'               => array( 'cloudflare-r2', 'qiniu-kodo', 'aliyun-oss', 'tencent-cos' ),
				'backupService'         => array( 'cloudflare-r2', 'qiniu-kodo', 'aliyun-oss', 'tencent-cos' ),
				'remoteImageUploadMode' => array( 'both', 'visual', 'source', 'off' ),
				'titleDisplay'          => array( 'none', 'filename' ),
			),
			'markdown' => array(
				'tableAlignment'  => array( 'auto', 'left', 'center' ),
				'codeLineNumbers' => array( 'show', 'hide' ),
			),
		);
		foreach ( $enums as $section => $fields ) {
			foreach ( $fields as $field => $allowed ) {
				if ( ! in_array( $value[ $section ][ $field ], $allowed, true ) ) {
					return $this->invalid_payload_error();
				}
			}
		}

		foreach ( array( 'domain', 'backupDomain' ) as $field ) {
			if ( ! $this->is_valid_domain( $value['images'][ $field ] ) ) {
				return $this->invalid_payload_error();
			}
		}
		if (
			! $this->is_valid_provider_coordinates( $value['images']['service'], $value['images']['endpoint'] ) ||
			! $this->is_valid_provider_coordinates( $value['images']['backupService'], $value['images']['backupEndpoint'] )
		) {
			return $this->invalid_payload_error();
		}
		if ( ! $this->is_valid_file_name_rule( $value['images']['storagePath'], $value['images']['fileNameRule'] ) ) {
			return $this->invalid_payload_error();
		}

		return true;
	}

	private function has_valid_update_nonce( WP_REST_Request $request ) {
		$nonce = $request->get_header( 'X-EasyMDE-Settings-Nonce' );

		return is_string( $nonce ) && '' !== $nonce && wp_verify_nonce( $nonce, self::UPDATE_NONCE_ACTION );
	}

	private function update_request_is_too_large( WP_REST_Request $request ) {
		$content_length = $request->get_header( 'content-length' );
		if ( null !== $content_length && '' !== $content_length ) {
			if ( ! preg_match( '/^(?:0|[1-9][0-9]*)$/', $content_length ) || strlen( ltrim( $content_length, '0' ) ) > strlen( (string) self::MAX_UPDATE_BODY_BYTES ) || (int) $content_length > self::MAX_UPDATE_BODY_BYTES ) {
				return true;
			}
		}

		$body = $request->get_body();

		return is_string( $body ) && strlen( $body ) > self::MAX_UPDATE_BODY_BYTES;
	}

	private function is_valid_domain( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return is_string( $value );
		}

		$parts = wp_parse_url( $value );
		if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['port'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) || ( isset( $parts['path'] ) && '' !== $parts['path'] && '/' !== $parts['path'] ) ) {
			return false;
		}

		if ( ! in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
			return false;
		}

		$url = esc_url_raw( $value, array( 'http', 'https' ) );

		return is_string( $url ) && '' !== $url;
	}

	private function is_valid_provider_coordinates( $service, $endpoint ) {
		if ( 'qiniu-kodo' === $service ) {
			return '' === $endpoint;
		}
		if ( in_array( $service, array( 'cloudflare-r2', 'aliyun-oss', 'tencent-cos' ), true ) ) {
			return '' === $endpoint || ImageHostProviderSupport::validate_provider_endpoint( $service, $endpoint );
		}

		return false;
	}

	private function is_valid_file_name_rule( $storage_path, $file_name_rule ) {
		try {
			( new ObjectKeyBuilder() )->validate( $storage_path, $file_name_rule );

			return true;
		} catch ( ImageHostException $exception ) {
			return false;
		}
	}

	private function normalize_legacy_image_payload( array $value ) {
		if ( ! isset( $value['images'] ) || ! is_array( $value['images'] ) ) {
			return $value;
		}
		$has_storage_path = array_key_exists( 'storagePath', $value['images'] );
		$legacy_formats   = isset( $value['images']['uploadFormats'] ) && $this->is_legacy_upload_formats( $value['images']['uploadFormats'] );
		if ( $has_storage_path && ! $legacy_formats ) {
			return $value;
		}

		if ( $legacy_formats ) {
			$formats = ImageUploadExtensionPolicy::normalize( $value['images']['uploadFormats'] );
			if ( is_array( $formats ) ) {
				$value['images']['uploadFormats'] = $formats;
			}
		}
		if ( $has_storage_path ) {
			if ( ! array_key_exists( 'fileNameRule', $value['images'] ) || ! is_string( $value['images']['storagePath'] ) || ! is_string( $value['images']['fileNameRule'] ) || false === strpos( $value['images']['fileNameRule'], '{ext}' ) ) {
				return $value;
			}
			$legacy_template = ( new ObjectKeyBuilder() )->combine( $value['images']['storagePath'], $value['images']['fileNameRule'] );
			$split           = ObjectKeyBuilder::split_legacy_template( $legacy_template );
			if ( is_array( $split ) && $split[0] === $value['images']['storagePath'] ) {
				$value['images']['fileNameRule'] = $split[1];
			}

			return $value;
		}
		if ( ! array_key_exists( 'fileNameRule', $value['images'] ) ) {
			return $value;
		}

		try {
			( new ObjectKeyBuilder() )->validate_legacy_template( $value['images']['fileNameRule'] );
		} catch ( ImageHostException $exception ) {
			return $value;
		}

		$split = ObjectKeyBuilder::split_legacy_template( $value['images']['fileNameRule'] );
		if ( is_array( $split ) ) {
			$value['images']['storagePath']  = $split[0];
			$value['images']['fileNameRule'] = $split[1];
		}

		return $value;
	}

	private function legacy_settings_payload_kind( $value ) {
		if ( ! is_array( $value ) || ! isset( $value['images'] ) || ! is_array( $value['images'] ) ) {
			return false;
		}
		if ( ! array_key_exists( 'storagePath', $value['images'] ) ) {
			return 'combined';
		}

		return isset( $value['images']['uploadFormats'] ) && $this->is_legacy_upload_formats( $value['images']['uploadFormats'] )
			? 'split'
			: false;
	}

	private function project_legacy_settings_response( array $response, $preserve_storage_path = false ) {
		$settings                = $response['settings'];
		$images                  = $settings['images'];
		$images['fileNameRule']  = $preserve_storage_path
			? $images['fileNameRule'] . '.{ext}'
			: ( new ObjectKeyBuilder() )->combine( $images['storagePath'], $images['fileNameRule'] ) . '.{ext}';
		$images['uploadFormats'] = array(
			'jpg'  => ! empty( $images['uploadFormats']['jpg'] ),
			'png'  => ! empty( $images['uploadFormats']['png'] ),
			'webp' => ! empty( $images['uploadFormats']['webp'] ),
			'gif'  => ! empty( $images['uploadFormats']['gif'] ),
		);
		if ( ! $preserve_storage_path ) {
			unset( $images['storagePath'] );
		}
		$settings['images']   = $images;
		$response['settings'] = $settings;

		return $response;
	}

	private function is_legacy_upload_formats( $formats ) {
		if ( ! is_array( $formats ) || ! $this->has_exact_keys( $formats, array( 'jpg', 'png', 'webp', 'gif' ) ) ) {
			return false;
		}
		foreach ( $formats as $enabled ) {
			if ( ! is_bool( $enabled ) ) {
				return false;
			}
		}

		return true;
	}

	private function has_exact_keys( array $value, array $expected ) {
		if ( count( $value ) !== count( $expected ) ) {
			return false;
		}

		foreach ( $expected as $key ) {
			if ( ! array_key_exists( $key, $value ) ) {
				return false;
			}
		}

		return true;
	}

	private function invalid_payload_error() {
		return new WP_Error(
			'easymde_settings_invalid_payload',
			__( 'The settings payload is invalid.', 'easymde' ),
			array( 'status' => 400 )
		);
	}

	private function settings_configuration_error() {
		return new WP_Error(
			SettingsCenterRepository::CONFIGURATION_ERROR_CODE,
			__( 'The settings configuration is unavailable.', 'easymde' ),
			array( 'status' => 500 )
		);
	}
}
