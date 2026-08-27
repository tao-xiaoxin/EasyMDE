<?php

namespace EasyMDE\Rest;

use EasyMDE\ImageHosting\ImageHostProviderSupport;
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

		return rest_ensure_response( $this->settings_repository->get_settings_response() );
	}

	public function handle_update_request( WP_REST_Request $request ) {
		$settings = $request->get_param( 'settings' );
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

		$result = $this->settings_repository->update_settings_response( $settings, $reset );
		if ( is_wp_error( $result ) ) {
			return $result;
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

		$shapes = array(
			'settings'  => array( 'revision', 'general', 'images', 'markdown', 'shortcuts' ),
			'general'   => array( 'interfaceLanguage', 'editingMode', 'autoFocusEditor', 'showLineNumbers', 'syntaxHighlight', 'statusBarMode', 'autoSave', 'autoSaveInterval', 'syncScroll', 'publishVisibility', 'openPreviewAfterPublish', 'applyEditorThemeToFrontend', 'showPublishedCodeCopyButton', 'summaryMode' ),
			'images'    => array( 'service', 'endpoint', 'bucket', 'domain', 'accessKey', 'secretKey', 'fileNameRule', 'uploadRetryCount', 'backupEnabled', 'backupService', 'backupEndpoint', 'backupBucket', 'backupDomain', 'backupAccessKey', 'backupSecretKey', 'compressImages', 'autoUploadPastedImages', 'remoteImageUploadMode', 'maxImageSizeMb', 'uploadFormats', 'titleDisplay' ),
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
			'general'  => array( 'autoFocusEditor', 'showLineNumbers', 'syntaxHighlight', 'autoSave', 'syncScroll', 'openPreviewAfterPublish', 'applyEditorThemeToFrontend', 'showPublishedCodeCopyButton' ),
			'images'   => array( 'backupEnabled', 'compressImages', 'autoUploadPastedImages' ),
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

		if ( ! is_array( $value['images']['uploadFormats'] ) || ! $this->has_exact_keys( $value['images']['uploadFormats'], array( 'jpg', 'png', 'webp', 'gif' ) ) ) {
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
				'autoSaveInterval'  => array( '30', '60', '120', '300' ),
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
		if ( ! $this->is_valid_file_name_rule( $value['images']['fileNameRule'] ) ) {
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

	private function is_valid_file_name_rule( $rule ) {
		if ( ! is_string( $rule ) || '' === $rule || strlen( $rule ) > 160 || '/' === $rule[0] || '/' === substr( $rule, -1 ) || false !== strpos( $rule, '\\' ) || false !== strpos( $rule, '..' ) || false !== strpos( $rule, '//' ) || preg_match( '/[\x00-\x1F\x7F?#]/', $rule ) ) {
			return false;
		}

		if ( ! preg_match_all( '/\{([A-Za-z0-9_]+)\}/', $rule, $matches ) || ! in_array( 'ext', $matches[1], true ) ) {
			return false;
		}

		$allowed = array( 'year', 'month', 'day', 'date', 'time', 'post_id', 'md5', 'uuid', 'name', 'ext' );
		foreach ( $matches[1] as $variable ) {
			if ( ! in_array( $variable, $allowed, true ) ) {
				return false;
			}
		}

		$literal = preg_replace( '/\{[A-Za-z0-9_]+\}/', '', $rule );

		return is_string( $literal ) && 1 === preg_match( '/^[A-Za-z0-9._\/-]*$/D', $literal ) && false === strpos( $literal, '{' ) && false === strpos( $literal, '}' );
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
}
