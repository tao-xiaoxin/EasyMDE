<?php

namespace EasyMDE\Rest;

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

		return rest_ensure_response(
			array(
				'settings' => $this->settings_repository->get_settings(),
			)
		);
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

		$result = $this->settings_repository->update_settings( $settings, $reset );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( array( 'settings' => $result ) );
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
			'general'   => array( 'interfaceLanguage', 'editingMode', 'autoFocusEditor', 'showLineNumbers', 'syntaxHighlight', 'statusBarMode', 'autoSave', 'autoSaveInterval', 'syncScroll', 'cleanPastedContent', 'smartListRecognition', 'defaultCategory', 'publishVisibility', 'openPreviewAfterPublish', 'summaryMode', 'featuredImagePlaceholder' ),
			'images'    => array( 'service', 'bucket', 'domain', 'accessKey', 'secretKey', 'fileNameRule', 'backupEnabled', 'backupService', 'backupBucket', 'backupDomain', 'backupAccessKey', 'backupSecretKey', 'backupSameObjectKey', 'backupFailureMode', 'insertMarkdown', 'compressImages', 'preserveFileName', 'copyUrl', 'retryCount', 'maxImageSize', 'uploadFormats', 'insertFormat', 'altSource', 'captionMode', 'featuredPlaceholder' ),
			'markdown'  => array( 'livePreview', 'wordWrap', 'lineNumbers', 'fixedToolbar', 'editorTheme', 'editorFontSize', 'editorFont', 'githubFlavor', 'smartPunctuation', 'tableAlignment', 'codeTheme', 'codeLineNumbers', 'taskLists', 'emoji', 'math', 'htmlRendering', 'tableExtension', 'footnotes', 'definitionLists', 'toc', 'imageSizeSyntax', 'pasteAsMarkdown', 'lineEnding', 'unorderedMarker', 'orderedStart', 'blockquoteStyle' ),
			'shortcuts' => array( 'values', 'showHints', 'detectConflicts', 'showSuggestions' ),
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
				'defaultCategory'   => 16,
				'publishVisibility' => 16,
				'summaryMode'       => 16,
			),
			'images'   => array(
				'service'           => 32,
				'bucket'            => 160,
				'domain'            => 255,
				'accessKey'         => 255,
				'secretKey'         => 255,
				'fileNameRule'      => 160,
				'backupService'     => 32,
				'backupBucket'      => 160,
				'backupDomain'      => 255,
				'backupAccessKey'   => 255,
				'backupSecretKey'   => 255,
				'backupFailureMode' => 32,
				'retryCount'        => 16,
				'maxImageSize'      => 16,
				'insertFormat'      => 16,
				'altSource'         => 16,
				'captionMode'       => 16,
			),
			'markdown' => array(
				'editorTheme'     => 16,
				'editorFontSize'  => 16,
				'editorFont'      => 32,
				'tableAlignment'  => 16,
				'codeTheme'       => 16,
				'codeLineNumbers' => 16,
				'lineEnding'      => 16,
				'unorderedMarker' => 120,
				'orderedStart'    => 120,
				'blockquoteStyle' => 16,
			),
		);
		$boolean_fields = array(
			'general'   => array( 'autoFocusEditor', 'showLineNumbers', 'syntaxHighlight', 'autoSave', 'syncScroll', 'cleanPastedContent', 'smartListRecognition', 'openPreviewAfterPublish', 'featuredImagePlaceholder' ),
			'images'    => array( 'backupEnabled', 'backupSameObjectKey', 'insertMarkdown', 'compressImages', 'preserveFileName', 'copyUrl', 'featuredPlaceholder' ),
			'markdown'  => array( 'livePreview', 'wordWrap', 'lineNumbers', 'fixedToolbar', 'githubFlavor', 'smartPunctuation', 'taskLists', 'emoji', 'math', 'htmlRendering', 'tableExtension', 'footnotes', 'definitionLists', 'toc', 'imageSizeSyntax', 'pasteAsMarkdown' ),
			'shortcuts' => array( 'showHints', 'detectConflicts', 'showSuggestions' ),
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

		$shortcut_ids = array( 'save', 'bold', 'italic', 'link', 'image', 'heading-one', 'heading-two', 'quote', 'unordered-list', 'ordered-list' );
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
				'statusBarMode'     => array( 'words-reading-time', 'words', 'hidden' ),
				'autoSaveInterval'  => array( '30', '60', '120', '300' ),
				'defaultCategory'   => array( 'none', 'current' ),
				'publishVisibility' => array( 'public', 'private', 'password' ),
				'summaryMode'       => array( 'auto-55', 'auto-100', 'manual' ),
			),
			'images'   => array(
				'service'           => array( 'cloudflare-r2', 'aliyun-oss', 'tencent-cos', 'custom' ),
				'backupService'     => array( 'qiniu-kodo', 'cloudflare-r2', 'aliyun-oss', 'tencent-cos', 'custom' ),
				'backupFailureMode' => array( 'return-primary-url', 'fail-upload' ),
				'retryCount'        => array( 'none', 'once', 'twice', 'three-times' ),
				'maxImageSize'      => array( 'original', '1920', '2560', '3840' ),
				'insertFormat'      => array( 'markdown', 'html', 'url' ),
				'altSource'         => array( 'filename', 'empty', 'upload' ),
				'captionMode'       => array( 'none', 'filename', 'upload' ),
			),
			'markdown' => array(
				'editorTheme'     => array( 'system', 'light', 'dark' ),
				'editorFontSize'  => array( '12px', '13px', '14px', '15px', '16px', '18px' ),
				'editorFont'      => array( 'system', 'monospace', 'source-han-sans' ),
				'tableAlignment'  => array( 'auto', 'left', 'center' ),
				'codeTheme'       => array( 'light', 'dark', 'follow-editor' ),
				'codeLineNumbers' => array( 'show', 'hide' ),
				'lineEnding'      => array( 'system', 'lf', 'crlf' ),
				'blockquoteStyle' => array( 'standard', 'spaced' ),
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
		if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) || isset( $parts['user'], $parts['pass'], $parts['query'], $parts['fragment'] ) ) {
			return false;
		}

		if ( ! in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
			return false;
		}

		$url = esc_url_raw( $value, array( 'http', 'https' ) );

		return is_string( $url ) && '' !== $url;
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
