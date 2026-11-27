<?php

namespace EasyMDE\Support;

use EasyMDE\ImageHosting\ImageUploadExtensionPolicy;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsCenterRepository {

	const CONFIGURATION_ERROR_CODE = 'easymde_settings_configuration_invalid';

	private $options;
	private $shortcuts;
	private $sanitizer;

	public function __construct( Options $options, ToolbarRegistry $toolbar_registry ) {
		$this->options   = $options;
		$this->shortcuts = new SettingsCenterShortcuts( $toolbar_registry );
		$this->sanitizer = new SettingsCenterSanitizer();
	}

	public function get_settings( $refresh_cache = false ) {
		return $this->settings_from_stored( $this->options->get_editor_settings( $refresh_cache ) );
	}

	/**
	 * Return the complete public settings response from one stored snapshot.
	 *
	 * @return array{settings: array, credentialStatus: array}
	 */
	public function get_settings_response( $refresh_cache = false ) {
		return $this->settings_response_from_stored( $this->options->get_editor_settings( $refresh_cache ) );
	}

	private function settings_from_stored( array $stored ) {
		$defaults = $this->get_defaults();
		$settings = isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] )
			? $stored['settings_center']
			: array();
		$settings = $this->sanitizer->migrate_legacy_image_settings( $settings );
		$this->sanitizer->assert_canonical_image_settings( $settings );

		$settings                             = $this->sanitizer->normalize_enum_settings( $this->sanitizer->merge_settings( $defaults, $settings ) );
		$settings['images']['endpoint']       = $this->sanitizer->sanitize_endpoint( $settings['images']['endpoint'] );
		$settings['images']['domain']         = $this->sanitizer->sanitize_domain( $settings['images']['domain'] );
		$settings['images']['backupEndpoint'] = $this->sanitizer->sanitize_endpoint( $settings['images']['backupEndpoint'] );
		$settings['images']['backupDomain']   = $this->sanitizer->sanitize_domain( $settings['images']['backupDomain'] );
		if ( ! $this->sanitizer->is_valid_file_name_rule( $settings['images']['storagePath'], $settings['images']['fileNameRule'] ) ) {
			// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Stable internal configuration code, not output.
			throw new \RuntimeException( self::CONFIGURATION_ERROR_CODE );
		}
		foreach ( array( 'accessKey', 'secretKey', 'backupAccessKey', 'backupSecretKey' ) as $secret_key ) {
			$settings['images'][ $secret_key ] = '';
		}
		$revision = $this->revision_from_stored( $stored );
		unset( $settings['revision'] );

		return array( 'revision' => $revision ) + $settings;
	}

	public function get_default_settings() {
		$settings = $this->sanitizer->normalize_enum_settings( $this->get_defaults() );
		foreach ( array( 'accessKey', 'secretKey', 'backupAccessKey', 'backupSecretKey' ) as $secret_key ) {
			$settings['images'][ $secret_key ] = '';
		}
		return array( 'revision' => 0 ) + $settings;
	}

	public function get_revision( $refresh_cache = false ) {
		return $this->revision_from_stored( $this->options->get_editor_settings( $refresh_cache ) );
	}

	public function should_apply_editor_theme_to_frontend() {
		$settings = $this->get_published_presentation_settings();

		return $settings['general']['applyEditorThemeToFrontend'];
	}

	public function should_show_published_code_copy_button() {
		$settings = $this->get_published_presentation_settings();

		return $settings['general']['showPublishedCodeCopyButton'];
	}

	public function get_published_table_alignment() {
		$settings = $this->get_published_presentation_settings();

		return $settings['markdown']['tableAlignment'];
	}

	public function should_show_published_code_line_numbers() {
		$settings = $this->get_published_presentation_settings();

		return 'show' === $settings['markdown']['codeLineNumbers'];
	}

	public function get_shortcut_config_for_script() {
		$settings = $this->get_settings();

		return $this->shortcuts->get_shortcut_config_for_script( $settings['shortcuts']['values'] );
	}

	public function get_reserved_shortcuts_for_script() {
		return $this->shortcuts->get_reserved_shortcuts_for_script();
	}

	public function get_allowed_image_mime_types() {
		return $this->get_media_upload_settings()['mime_types'];
	}

	/**
	 * Return the non-secret settings required by the WordPress Media endpoint.
	 *
	 * The option is read once so MIME, size, filename rule, and title behavior
	 * stay on one settings snapshot for the complete upload operation.
	 *
	 * @return array{storage_path: string, file_name_rule: string, max_bytes: int, mime_types: string[], allowed_extensions: string[], title_display: string}
	 */
	public function get_media_upload_settings() {
		$settings = $this->settings_from_stored( $this->options->get_editor_settings() );
		$formats  = $settings['images']['uploadFormats'];

		return array(
			'storage_path'       => $settings['images']['storagePath'],
			'file_name_rule'     => $settings['images']['fileNameRule'],
			'max_bytes'          => min( $settings['images']['maxImageSizeMb'] * MB_IN_BYTES, (int) wp_max_upload_size(), 10 * MB_IN_BYTES ),
			'mime_types'         => ImageUploadExtensionPolicy::mime_types( $formats ),
			'allowed_extensions' => ImageUploadExtensionPolicy::enabled( $formats ),
			'title_display'      => $settings['images']['titleDisplay'],
		);
	}

	public function get_effective_image_upload_max_bytes() {
		return $this->get_media_upload_settings()['max_bytes'];
	}

	/**
	 * Return the server-only image-hosting runtime configuration.
	 *
	 * This method intentionally includes stored credentials. Callers must never
	 * serialize its result into Bootstrap data, REST responses, logs, or errors.
	 *
	 * @return array
	 */
	public function get_image_hosting_settings() {
		return $this->image_hosting_settings_from_stored( $this->options->get_editor_settings() );
	}

	/**
	 * Return one current stored image-hosting credential for an authorized caller.
	 *
	 * This value must never be included in Bootstrap, ordinary settings responses,
	 * exports, logs, diagnostics, or errors.
	 *
	 * @param string $target   Credential target.
	 * @param string $field    Credential field.
	 * @param int    $revision Expected settings revision.
	 * @return string|WP_Error
	 */
	public function get_image_hosting_secret( $target, $field, $revision ) {
		$field_map = array(
			'primary' => array(
				'accessKey' => 'accessKey',
				'secretKey' => 'secretKey',
			),
			'backup'  => array(
				'accessKey' => 'backupAccessKey',
				'secretKey' => 'backupSecretKey',
			),
		);
		$stored    = $this->options->get_editor_settings();

		if (
			! is_int( $revision ) ||
			$revision !== $this->revision_from_stored( $stored ) ||
			! isset( $field_map[ $target ][ $field ] ) ||
			! isset( $stored['settings_center']['images'] ) ||
			! is_array( $stored['settings_center']['images'] )
		) {
			return $this->secret_unavailable_error();
		}

		$stored_field = $field_map[ $target ][ $field ];
		$value        = isset( $stored['settings_center']['images'][ $stored_field ] )
			? $this->sanitizer->bounded_text( $stored['settings_center']['images'][ $stored_field ], 255 )
			: '';

		return '' !== $value ? $value : $this->secret_unavailable_error();
	}

	private function image_hosting_settings_from_stored( array $stored ) {
		$settings = isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] )
			? $stored['settings_center']
			: array();
		$settings = $this->sanitizer->migrate_legacy_image_settings( $settings );
		$this->sanitizer->assert_canonical_image_settings( $settings );
		$settings = $this->sanitizer->normalize_enum_settings( $this->sanitizer->merge_settings( $this->get_defaults(), $settings ) );
		$images   = $settings['images'];

		$images['endpoint']        = $this->sanitizer->sanitize_endpoint( $images['endpoint'] );
		$images['bucket']          = $this->sanitizer->bounded_text( $images['bucket'], 128 );
		$images['domain']          = $this->sanitizer->sanitize_domain( $images['domain'] );
		$images['accessKey']       = $this->sanitizer->bounded_text( $images['accessKey'], 255 );
		$images['secretKey']       = $this->sanitizer->bounded_text( $images['secretKey'], 255 );
		$images['backupBucket']    = $this->sanitizer->bounded_text( $images['backupBucket'], 128 );
		$images['backupEndpoint']  = $this->sanitizer->sanitize_endpoint( $images['backupEndpoint'] );
		$images['backupDomain']    = $this->sanitizer->sanitize_domain( $images['backupDomain'] );
		$images['backupAccessKey'] = $this->sanitizer->bounded_text( $images['backupAccessKey'], 255 );
		$images['backupSecretKey'] = $this->sanitizer->bounded_text( $images['backupSecretKey'], 255 );
		if ( ! $this->sanitizer->is_valid_file_name_rule( $images['storagePath'], $images['fileNameRule'] ) ) {
			// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Stable internal configuration code, not output.
			throw new \RuntimeException( self::CONFIGURATION_ERROR_CODE );
		}

		return array(
			'enabled'          => $images['imageHostingEnabled'],
			'revision'         => $this->revision_from_stored( $stored ),
			'primary'          => array(
				'retryCount' => $images['uploadRetryCount'],
				'service'    => $images['service'],
				'endpoint'   => $images['endpoint'],
				'bucket'     => $images['bucket'],
				'domain'     => $images['domain'],
				'accessKey'  => $images['accessKey'],
				'secretKey'  => $images['secretKey'],
			),
			'backup'           => array(
				'enabled'    => $images['backupEnabled'],
				'retryCount' => $images['uploadRetryCount'],
				'service'    => $images['backupService'],
				'endpoint'   => $images['backupEndpoint'],
				'bucket'     => $images['backupBucket'],
				'domain'     => $images['backupDomain'],
				'accessKey'  => $images['backupAccessKey'],
				'secretKey'  => $images['backupSecretKey'],
			),
			'storagePath'      => $images['storagePath'],
			'fileNameRule'     => $images['fileNameRule'],
			'behaviors'        => array(
				'autoCompress'          => $images['compressImages'],
				'maxBytes'              => min( $images['maxImageSizeMb'] * MB_IN_BYTES, (int) wp_max_upload_size(), 10 * MB_IN_BYTES ),
				'uploadFormats'         => array_keys( array_filter( $images['uploadFormats'] ) ),
				'allowedExtensions'     => ImageUploadExtensionPolicy::enabled( $images['uploadFormats'] ),
				'titleDisplay'          => $images['titleDisplay'],
				'remoteImageUploadMode' => $images['remoteImageUploadMode'],
			),
			'credentialStatus' => array(
				'primaryConfigured' => '' !== $images['accessKey'] && '' !== $images['secretKey'],
				'backupConfigured'  => '' !== $images['backupAccessKey'] && '' !== $images['backupSecretKey'],
			),
		);
	}

	/**
	 * Return non-secret credential-presence metadata for presentation adapters.
	 *
	 * @return array{primaryConfigured: bool, backupConfigured: bool}
	 */
	public function get_image_credential_status() {
		$response = $this->get_settings_response();

		return $response['credentialStatus'];
	}

	public function update_settings( $input, $reset_secrets = false ) {
		$next = $this->persist_settings( $input, $reset_secrets );
		if ( is_wp_error( $next ) ) {
			return $next;
		}

		return $this->settings_from_stored( $next );
	}

	/**
	 * Persist settings and return the public response from the exact CAS result.
	 *
	 * @return array|WP_Error
	 */
	public function update_settings_response( $input, $reset_secrets = false ) {
		$next = $this->persist_settings( $input, $reset_secrets );
		if ( is_wp_error( $next ) ) {
			return $next;
		}

		return $this->settings_response_from_stored( $next );
	}

	private function persist_settings( $input, $reset_secrets = false ) {
		if ( ! is_array( $input ) || ! array_key_exists( 'revision', $input ) || ! is_int( $input['revision'] ) || $input['revision'] < 0 ) {
			return $this->invalid_payload_error();
		}

		$expected = $this->options->get_editor_settings_snapshot();
		if ( null === $expected ) {
			return $this->persistence_error();
		}
		$stored           = is_array( $expected ) ? $expected : array();
		$current_revision = $this->revision_from_stored( $stored );
		if ( $input['revision'] !== $current_revision ) {
			return $this->conflict_error();
		}

		if ( isset( $input['images'] ) && is_array( $input['images'] ) ) {
			foreach ( array( 'storagePath', 'fileNameRule' ) as $template_field ) {
				if ( array_key_exists( $template_field, $input['images'] ) && ! is_string( $input['images'][ $template_field ] ) ) {
					return $this->invalid_payload_error();
				}
			}
		}
		$stored_settings = $this->sanitizer->migrate_legacy_image_settings( $this->stored_settings_for_write( $stored ) );
		$settings        = $this->sanitizer->sanitize_settings(
			$input,
			$this->get_defaults(),
			$stored_settings,
			(bool) $reset_secrets,
			$this->shortcuts
		);
		if ( is_wp_error( $settings ) ) {
			return $settings;
		}

		$next                             = $stored;
		$next['settings_center']          = $settings;
		$next['version']                  = $this->options->editor_settings_version();
		$next['settings_center_revision'] = $current_revision + 1;
		unset( $next['shortcuts'] );

		if ( ! $this->options->compare_and_swap_editor_settings( $expected, $next ) ) {
			return $this->options->last_compare_and_swap_was_conflict()
				? $this->conflict_error()
				: $this->persistence_error();
		}

		return $next;
	}

	private function settings_response_from_stored( array $stored ) {
		$runtime = $this->image_hosting_settings_from_stored( $stored );

		return array(
			'settings'         => $this->settings_from_stored( $stored ),
			'credentialStatus' => $runtime['credentialStatus'],
		);
	}

	private function stored_settings_for_write( array $stored ) {
		$settings = isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] )
			? $stored['settings_center']
			: array();

		return $settings;
	}

	private function conflict_error() {
		return new WP_Error(
			'easymde_settings_conflict',
			__( 'Settings could not be saved. Try again.', 'easymde' ),
			array( 'status' => 409 )
		);
	}

	private function persistence_error() {
		return new WP_Error(
			'easymde_settings_persistence_failed',
			__( 'Settings could not be saved. Try again.', 'easymde' ),
			array( 'status' => 500 )
		);
	}

	private function invalid_payload_error() {
		return new WP_Error(
			'easymde_settings_invalid_payload',
			__( 'The settings payload is invalid.', 'easymde' ),
			array( 'status' => 400 )
		);
	}

	private function secret_unavailable_error() {
		return new WP_Error(
			'easymde_image_hosting_secret_unavailable',
			__( 'The image-hosting configuration is unavailable.', 'easymde' ),
			array( 'status' => 409 )
		);
	}

	private function revision_from_stored( array $stored ) {
		return isset( $stored['settings_center_revision'] ) && is_numeric( $stored['settings_center_revision'] )
			? max( 0, absint( $stored['settings_center_revision'] ) )
			: 0;
	}

	private function get_defaults() {
		return array(
			'general'   => array(
				'interfaceLanguage'           => 'zh-CN',
				'editingMode'                 => 'live-preview',
				'showLineNumbers'             => true,
				'statusBarMode'               => 'detailed',
				'autoSave'                    => true,
				'autoSaveInterval'            => '30',
				'syncScroll'                  => true,
				'publishVisibility'           => 'public',
				'openPreviewAfterPublish'     => true,
				'applyEditorThemeToFrontend'  => true,
				'showPublishedCodeCopyButton' => true,
				'summaryMode'                 => 'auto-55',
			),
			'images'    => array(
				'imageHostingEnabled'    => false,
				'wechatPngExportEnabled' => false,
				'service'                => 'cloudflare-r2',
				'endpoint'               => '',
				'bucket'                 => 'easymde-assets',
				'domain'                 => '',
				'accessKey'              => '',
				'secretKey'              => '',
				'storagePath'            => '{year}/{month}',
				'fileNameRule'           => '{md5}',
				'backupEnabled'          => false,
				'backupService'          => 'qiniu-kodo',
				'backupEndpoint'         => '',
				'backupBucket'           => 'easymde-backup',
				'backupDomain'           => '',
				'backupAccessKey'        => '',
				'backupSecretKey'        => '',
				'uploadRetryCount'       => 0,
				'compressImages'         => true,
				'autoUploadPastedImages' => true,
				'remoteImageUploadMode'  => 'both',
				'maxImageSizeMb'         => 5,
				'uploadFormats'          => ImageUploadExtensionPolicy::defaults(),
				'titleDisplay'           => 'none',
			),
			'markdown'  => array(
				'wordWrap'         => true,
				'githubFlavor'     => true,
				'smartPunctuation' => true,
				'tableAlignment'   => 'center',
				'codeLineNumbers'  => 'show',
				'pasteAsMarkdown'  => true,
			),
			'shortcuts' => array(
				'values' => $this->shortcuts->get_default_values(),
			),
		);
	}

	private function get_published_presentation_settings() {
		$stored   = $this->options->get_editor_settings();
		$settings = isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] )
			? $stored['settings_center']
			: array();
		$defaults = array(
			'general'  => array(
				'applyEditorThemeToFrontend'  => true,
				'showPublishedCodeCopyButton' => true,
			),
			'markdown' => array(
				'tableAlignment'  => 'center',
				'codeLineNumbers' => 'show',
			),
		);

		return $this->sanitizer->normalize_enum_settings( $this->sanitizer->merge_settings( $defaults, $settings ) );
	}
}
