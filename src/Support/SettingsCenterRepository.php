<?php

namespace EasyMDE\Support;

use EasyMDE\ImageHosting\ImageHostDestinationIdentity;
use EasyMDE\ImageHosting\ImageHostProviderSupport;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsCenterRepository {

	private $options;
	private $toolbar_registry;

	public function __construct( Options $options, ToolbarRegistry $toolbar_registry ) {
		$this->options          = $options;
		$this->toolbar_registry = $toolbar_registry;
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
		$settings = $this->migrate_legacy_image_settings( $settings );

		$settings                             = $this->normalize_enum_settings( $this->merge_settings( $defaults, $settings ) );
		$settings['images']['endpoint']       = $this->sanitize_endpoint( $settings['images']['endpoint'] );
		$settings['images']['domain']         = $this->sanitize_domain( $settings['images']['domain'] );
		$settings['images']['backupEndpoint'] = $this->sanitize_endpoint( $settings['images']['backupEndpoint'] );
		$settings['images']['backupDomain']   = $this->sanitize_domain( $settings['images']['backupDomain'] );
		if ( ! $this->is_valid_file_name_rule( $settings['images']['fileNameRule'] ) ) {
			$settings['images']['fileNameRule'] = $defaults['images']['fileNameRule'];
		}
		foreach ( array( 'accessKey', 'secretKey', 'backupAccessKey', 'backupSecretKey' ) as $secret_key ) {
			$settings['images'][ $secret_key ] = '';
		}
		$revision = $this->revision_from_stored( $stored );
		unset( $settings['revision'] );

		return array( 'revision' => $revision ) + $settings;
	}

	public function get_default_settings() {
		$settings = $this->normalize_enum_settings( $this->get_defaults() );
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
		$settings  = $this->get_settings();
		$registry  = $this->toolbar_registry->get_command_registry();
		$shortcuts = array();

		foreach ( $registry as $command_id => $command ) {
			$center_id = $this->center_shortcut_id( $command_id );
			if ( $center_id && isset( $settings['shortcuts']['values'][ $center_id ] ) ) {
				$shortcuts[ $command_id ] = array(
					'win' => $settings['shortcuts']['values'][ $center_id ]['windows'],
					'mac' => $settings['shortcuts']['values'][ $center_id ]['mac'],
				);
				continue;
			}

			$shortcuts[ $command_id ] = array(
				'win' => $this->validated_registry_shortcut( $command, 'defaultShortcutWin', false ),
				'mac' => $this->validated_registry_shortcut( $command, 'defaultShortcutMac', true ),
			);
		}

		return $shortcuts;
	}

	public function get_reserved_shortcuts_for_script() {
		$reserved = array();

		foreach ( $this->toolbar_registry->get_commands_for_script() as $command ) {
			$command_id = isset( $command['id'] ) ? (string) $command['id'] : '';
			$windows    = $this->validated_registry_shortcut( $command, 'defaultShortcutWin', false );
			$mac        = $this->validated_registry_shortcut( $command, 'defaultShortcutMac', true );
			if ( $this->center_shortcut_id( $command_id ) || ( '' === $windows && '' === $mac ) ) {
				continue;
			}

			$reserved[] = array(
				'id'      => $command_id,
				'label'   => isset( $command['label'] ) ? (string) $command['label'] : $command_id,
				'windows' => $windows,
				'mac'     => $mac,
			);
		}

		return $reserved;
	}

	public function get_allowed_image_mime_types() {
		$settings             = $this->get_settings();
		$formats              = $settings['images']['uploadFormats'];
		$mime_types_by_format = array(
			'jpg'  => 'image/jpeg',
			'png'  => 'image/png',
			'webp' => 'image/webp',
			'gif'  => 'image/gif',
		);
		$mime_types           = array();

		foreach ( $mime_types_by_format as $format => $mime_type ) {
			if ( ! empty( $formats[ $format ] ) ) {
				$mime_types[] = $mime_type;
			}
		}

		return $mime_types;
	}

	public function get_effective_image_upload_max_bytes() {
		$settings = $this->get_settings();

		return min( $settings['images']['maxImageSizeMb'] * MB_IN_BYTES, (int) wp_max_upload_size(), 10 * MB_IN_BYTES );
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
			? $this->bounded_text( $stored['settings_center']['images'][ $stored_field ], 255 )
			: '';

		return '' !== $value ? $value : $this->secret_unavailable_error();
	}

	private function image_hosting_settings_from_stored( array $stored ) {
		$settings = isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] )
			? $stored['settings_center']
			: array();
		$settings = $this->migrate_legacy_image_settings( $settings );
		$settings = $this->normalize_enum_settings( $this->merge_settings( $this->get_defaults(), $settings ) );
		$images   = $settings['images'];

		$images['endpoint']        = $this->sanitize_endpoint( $images['endpoint'] );
		$images['bucket']          = $this->bounded_text( $images['bucket'], 128 );
		$images['domain']          = $this->sanitize_domain( $images['domain'] );
		$images['accessKey']       = $this->bounded_text( $images['accessKey'], 255 );
		$images['secretKey']       = $this->bounded_text( $images['secretKey'], 255 );
		$images['backupBucket']    = $this->bounded_text( $images['backupBucket'], 128 );
		$images['backupEndpoint']  = $this->sanitize_endpoint( $images['backupEndpoint'] );
		$images['backupDomain']    = $this->sanitize_domain( $images['backupDomain'] );
		$images['backupAccessKey'] = $this->bounded_text( $images['backupAccessKey'], 255 );
		$images['backupSecretKey'] = $this->bounded_text( $images['backupSecretKey'], 255 );
		if ( ! $this->is_valid_file_name_rule( $images['fileNameRule'] ) ) {
			$images['fileNameRule'] = $this->get_defaults()['images']['fileNameRule'];
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
			'fileNameRule'     => $images['fileNameRule'],
			'behaviors'        => array(
				'autoCompress'          => $images['compressImages'],
				'maxBytes'              => min( $images['maxImageSizeMb'] * MB_IN_BYTES, (int) wp_max_upload_size(), 10 * MB_IN_BYTES ),
				'uploadFormats'         => array_keys( array_filter( $images['uploadFormats'] ) ),
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
			return new WP_Error(
				'easymde_settings_invalid_payload',
				__( 'The settings payload is invalid.', 'easymde' ),
				array( 'status' => 400 )
			);
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

		$stored_settings = $this->stored_settings_for_write( $stored );
		$settings        = $this->sanitize_settings( $input, $stored_settings, (bool) $reset_secrets );
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

	private function migrate_legacy_image_settings( array $settings ) {
		if ( ! isset( $settings['images'] ) || ! is_array( $settings['images'] ) ) {
			return $settings;
		}

		if ( ! array_key_exists( 'titleDisplay', $settings['images'] ) && isset( $settings['images']['captionMode'] ) ) {
			$settings['images']['titleDisplay'] = 'filename' === $settings['images']['captionMode'] ? 'filename' : 'none';
		}

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
		$shortcuts = array();
		foreach ( $this->toolbar_registry->get_command_registry() as $command_id => $command ) {
			$center_id = $this->center_shortcut_id( $command_id );
			if ( ! $center_id ) {
				continue;
			}

			$shortcuts[ $center_id ] = array(
				'windows' => $this->validated_registry_shortcut( $command, 'defaultShortcutWin', false ),
				'mac'     => $this->validated_registry_shortcut( $command, 'defaultShortcutMac', true ),
			);
		}

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
				'imageHostingEnabled'   => false,
				'service'                => 'cloudflare-r2',
				'endpoint'               => '',
				'bucket'                 => 'easymde-assets',
				'domain'                 => '',
				'accessKey'              => '',
				'secretKey'              => '',
				'fileNameRule'           => '{year}/{month}/{md5}.{ext}',
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
				'uploadFormats'          => array(
					'jpg'  => true,
					'png'  => true,
					'webp' => true,
					'gif'  => true,
				),
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
				'values' => $shortcuts,
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

		return $this->normalize_enum_settings( $this->merge_settings( $defaults, $settings ) );
	}

	private function merge_settings( array $defaults, array $stored ) {
		$result = $defaults;
		foreach ( $defaults as $section => $section_defaults ) {
			if ( ! isset( $stored[ $section ] ) || ! is_array( $stored[ $section ] ) ) {
				continue;
			}

			foreach ( $section_defaults as $key => $default ) {
				if ( 'shortcuts' === $section && 'values' === $key ) {
					if ( ! is_array( $stored[ $section ][ $key ] ?? null ) ) {
						continue;
					}
					foreach ( $default as $shortcut_id => $shortcut_default ) {
						if ( isset( $stored[ $section ][ $key ][ $shortcut_id ] ) && is_array( $stored[ $section ][ $key ][ $shortcut_id ] ) ) {
							$result[ $section ][ $key ][ $shortcut_id ] = array_merge(
								$shortcut_default,
								$stored[ $section ][ $key ][ $shortcut_id ]
							);
						}
					}
					continue;
				}

				if ( array_key_exists( $key, $stored[ $section ] ) && gettype( $stored[ $section ][ $key ] ) === gettype( $default ) ) {
					$result[ $section ][ $key ] = $stored[ $section ][ $key ];
				}
			}
		}

		return $result;
	}

	private function sanitize_settings( array $input, array $stored_settings = array(), $reset_secrets = false ) {
		$defaults = $this->get_defaults();
		if ( isset( $input['general'] ) && is_array( $input['general'] ) ) {
			foreach ( array( 'applyEditorThemeToFrontend', 'showPublishedCodeCopyButton' ) as $boolean_field ) {
				if ( array_key_exists( $boolean_field, $input['general'] ) && ! is_bool( $input['general'][ $boolean_field ] ) ) {
					return $this->invalid_payload_error();
				}
			}
		}
		if ( isset( $input['images'] ) && is_array( $input['images'] ) ) {
			if ( array_key_exists( 'imageHostingEnabled', $input['images'] ) && ! is_bool( $input['images']['imageHostingEnabled'] ) ) {
				return $this->invalid_payload_error();
			}
			foreach ( array( 'uploadRetryCount' ) as $retry_field ) {
				if (
					array_key_exists( $retry_field, $input['images'] ) &&
					(
						! is_int( $input['images'][ $retry_field ] ) ||
						$input['images'][ $retry_field ] < 0 ||
						$input['images'][ $retry_field ] > 5
					)
				) {
					return new WP_Error(
						'easymde_settings_invalid_payload',
						__( 'The settings payload is invalid.', 'easymde' ),
						array( 'status' => 400 )
					);
				}
			}
			if (
				array_key_exists( 'maxImageSizeMb', $input['images'] ) &&
				( ! is_int( $input['images']['maxImageSizeMb'] ) || $input['images']['maxImageSizeMb'] < 1 || $input['images']['maxImageSizeMb'] > 10 )
			) {
				return $this->invalid_payload_error();
			}
			if (
				array_key_exists( 'titleDisplay', $input['images'] ) &&
				! in_array( $input['images']['titleDisplay'], array( 'filename', 'none' ), true )
			) {
				return $this->invalid_payload_error();
			}
			if (
				array_key_exists( 'remoteImageUploadMode', $input['images'] ) &&
				! in_array( $input['images']['remoteImageUploadMode'], array( 'both', 'visual', 'source', 'off' ), true )
			) {
				return $this->invalid_payload_error();
			}
		}
		$stored_settings = $this->migrate_legacy_image_settings( $stored_settings );
		$base            = $this->merge_settings( $defaults, $stored_settings );
		$settings        = $this->merge_settings( $base, $input );
		if ( isset( $input['images']['uploadFormats'] ) && is_array( $input['images']['uploadFormats'] ) ) {
			$settings['images']['uploadFormats'] = array_merge(
				$base['images']['uploadFormats'],
				$input['images']['uploadFormats']
			);
		}
		$settings = $this->normalize_enum_settings( $settings );
		if (
			! $this->is_valid_provider_coordinates( $settings['images']['service'], $settings['images']['endpoint'] ) ||
			! $this->is_valid_provider_coordinates( $settings['images']['backupService'], $settings['images']['backupEndpoint'] ) ||
			! $this->is_valid_file_name_rule( $settings['images']['fileNameRule'] )
		) {
			return new WP_Error(
				'easymde_settings_invalid_payload',
				__( 'The settings payload is invalid.', 'easymde' ),
				array( 'status' => 400 )
			);
		}

		foreach ( $settings['general'] as $key => $value ) {
			$settings['general'][ $key ] = is_bool( $value ) ? $value : $this->bounded_text( $value, 80 );
		}
		foreach ( $settings['markdown'] as $key => $value ) {
			$settings['markdown'][ $key ] = is_bool( $value ) ? $value : $this->bounded_text( $value, 120 );
		}
		foreach ( $settings['images'] as $key => $value ) {
			if ( in_array( $key, array( 'accessKey', 'secretKey', 'backupAccessKey', 'backupSecretKey' ), true ) ) {
				$submitted = trim( (string) $value );
				if ( ! $reset_secrets && '' === $submitted && isset( $stored_settings['images'] ) && is_array( $stored_settings['images'] ) && array_key_exists( $key, $stored_settings['images'] ) ) {
					$value = $stored_settings['images'][ $key ];
				}
				$settings['images'][ $key ] = $this->bounded_text( $value, 255 );
			} elseif ( 'uploadFormats' === $key ) {
				foreach ( $this->get_defaults()['images']['uploadFormats'] as $format => $enabled ) {
					$settings['images']['uploadFormats'][ $format ] = isset( $settings['images']['uploadFormats'][ $format ] )
						? (bool) $settings['images']['uploadFormats'][ $format ]
						: (bool) $enabled;
				}
			} elseif ( in_array( $key, array( 'domain', 'backupDomain' ), true ) ) {
				$settings['images'][ $key ] = $this->sanitize_domain( $value );
			} elseif ( 'endpoint' === $key || 'backupEndpoint' === $key ) {
				$settings['images'][ $key ] = $this->sanitize_endpoint( $value );
			} elseif ( in_array( $key, array( 'uploadRetryCount', 'maxImageSizeMb' ), true ) ) {
				$settings['images'][ $key ] = $value;
			} elseif ( is_bool( $value ) ) {
				$settings['images'][ $key ] = $value;
			} else {
				$settings['images'][ $key ] = $this->bounded_text( $value, 160 );
			}
		}

		foreach ( $settings['shortcuts']['values'] as $shortcut_id => $shortcut ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$normalized = $this->normalize_shortcut( $shortcut[ $platform ], 'mac' === $platform );
				if ( false === $normalized ) {
					return new WP_Error(
						'easymde_settings_invalid_shortcut',
						__( 'One or more shortcut values are invalid.', 'easymde' ),
						array( 'status' => 400 )
					);
				}
				$settings['shortcuts']['values'][ $shortcut_id ][ $platform ] = $normalized;
			}
		}
		$shortcut_conflict = $this->find_shortcut_conflict( $settings['shortcuts']['values'] );
		if ( $shortcut_conflict ) {
			return new WP_Error(
				'easymde_settings_shortcut_conflict',
				__( 'One or more shortcut values conflict.', 'easymde' ),
				array(
					'status'   => 409,
					'platform' => $shortcut_conflict['platform'],
					'shortcut' => $shortcut_conflict['shortcut'],
					'bindings' => $shortcut_conflict['bindings'],
				)
			);
		}

		if (
			! empty( $settings['images']['backupEnabled'] ) &&
			ImageHostDestinationIdentity::are_same(
				$this->destination_config( $settings['images'], false ),
				$this->destination_config( $settings['images'], true )
			)
		) {
			return new WP_Error(
				'easymde_settings_duplicate_image_host_destination',
				__( 'The primary and backup image hosts must use different storage destinations.', 'easymde' ),
				array( 'status' => 409 )
			);
		}

		return $settings;
	}
	private function normalize_enum_settings( array $settings ) {
		$defaults = array(
			'general'  => array(
				'interfaceLanguage' => 'zh-CN',
				'editingMode'       => 'live-preview',
				'statusBarMode'     => 'detailed',
				'autoSaveInterval'  => '30',
				'publishVisibility' => 'public',
				'summaryMode'       => 'auto-55',
			),
			'images'   => array(
				'service'               => 'cloudflare-r2',
				'backupService'         => 'qiniu-kodo',
				'remoteImageUploadMode' => 'both',
				'titleDisplay'          => 'none',
			),
			'markdown' => array(
				'tableAlignment'  => 'center',
				'codeLineNumbers' => 'show',
			),
		);
		$aliases  = array(
			'general'  => array(
				'interfaceLanguage' => array(
					'zh-CN' => 'zh-CN',
					'zh-TW' => 'zh-TW',
					'en-US' => 'en-US',
				),
				'editingMode'       => array(
					'live-preview' => 'live-preview',
					'source'       => 'source',
					'preview'      => 'preview',
				),
				'statusBarMode'     => array(
					'detailed'           => 'detailed',
					'compact'            => 'compact',
					'words-reading-time' => 'detailed',
					'words'              => 'compact',
					'hidden'             => 'hidden',
				),
				'autoSaveInterval'  => array(
					'5'   => '5',
					'30'  => '30',
					'60'  => '60',
					'120' => '120',
					'300' => '300',
				),
				'publishVisibility' => array(
					'public'   => 'public',
					'private'  => 'private',
					'password' => 'password',
				),
				'summaryMode'       => array(
					'auto-55'  => 'auto-55',
					'auto-100' => 'auto-100',
					'manual'   => 'manual',
				),
			),
			'images'   => array(
				'service'               => array(
					'cloudflare-r2' => 'cloudflare-r2',
					'qiniu-kodo'    => 'qiniu-kodo',
					'aliyun-oss'    => 'aliyun-oss',
					'tencent-cos'   => 'tencent-cos',
				),
				'backupService'         => array(
					'qiniu-kodo'    => 'qiniu-kodo',
					'cloudflare-r2' => 'cloudflare-r2',
					'aliyun-oss'    => 'aliyun-oss',
					'tencent-cos'   => 'tencent-cos',
				),
				'remoteImageUploadMode' => array(
					'both'   => 'both',
					'visual' => 'visual',
					'source' => 'source',
					'off'    => 'off',
				),
				'titleDisplay'          => array(
					'none'          => 'none',
					'Do not insert' => 'none',
					'filename'      => 'filename',
					'Use file name' => 'filename',
				),
			),
			'markdown' => array(
				'tableAlignment'  => array(
					'auto'                  => 'auto',
					'Auto align by content' => 'auto',
					'left'                  => 'left',
					'Align left'            => 'left',
					'center'                => 'center',
					'Align center'          => 'center',
				),
				'codeLineNumbers' => array(
					'show' => 'show',
					'Show' => 'show',
					'hide' => 'hide',
					'Hide' => 'hide',
				),
			),
		);

		foreach ( $aliases as $section => $section_aliases ) {
			foreach ( $section_aliases as $key => $value_aliases ) {
				if ( ! isset( $settings[ $section ][ $key ] ) ) {
					continue;
				}
				$value                        = (string) $settings[ $section ][ $key ];
				$settings[ $section ][ $key ] = isset( $value_aliases[ $value ] )
					? $value_aliases[ $value ]
					: $defaults[ $section ][ $key ];
			}
		}

		return $settings;
	}


	private function bounded_text( $value, $length ) {
		$value = sanitize_text_field( (string) $value );

		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $length ) : substr( $value, 0, $length );
	}

	private function sanitize_domain( $value ) {
		$value = trim( (string) $value );
		if ( '' === $value ) {
			return '';
		}
		$parts = wp_parse_url( $value );
		if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['port'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) || ( isset( $parts['path'] ) && '' !== $parts['path'] && '/' !== $parts['path'] ) ) {
			return '';
		}
		if ( ! in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
			return '';
		}
		$url = esc_url_raw( $value, array( 'http', 'https' ) );

		return is_string( $url ) ? $this->bounded_text( $url, 255 ) : '';
	}

	private function sanitize_endpoint( $value ) {
		$value = strtolower( rtrim( trim( (string) $value ), '/' ) );

		return $this->is_valid_endpoint( $value ) ? $this->bounded_text( $value, 255 ) : '';
	}

	private function is_valid_endpoint( $value ) {
		return is_string( $value ) && ( '' === $value || ImageHostProviderSupport::validate_r2_endpoint( $value ) || ImageHostProviderSupport::validate_oss_endpoint( $value ) || ImageHostProviderSupport::validate_cos_endpoint( $value ) );
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

	private function destination_config( array $images, $backup ) {
		return array(
			'service'  => $images[ $backup ? 'backupService' : 'service' ],
			'endpoint' => $images[ $backup ? 'backupEndpoint' : 'endpoint' ],
			'bucket'   => $images[ $backup ? 'backupBucket' : 'bucket' ],
		);
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

	private function normalize_shortcut( $value, $is_mac ) {
		if ( ! is_string( $value ) ) {
			return false;
		}
		if ( '' === $value ) {
			return '';
		}
		$parts = explode( '+', $value );
		if ( count( $parts ) < 2 || count( $parts ) > 5 ) {
			return false;
		}
		$key = array_pop( $parts );
		if ( ! $this->is_canonical_shortcut_key( $key ) ) {
			return false;
		}

		$order      = $is_mac ? array( 'Cmd', 'Ctrl', 'Option', 'Shift' ) : array( 'Ctrl', 'Alt', 'Shift', 'Meta' );
		$last_index = -1;
		$has_owner  = false;
		foreach ( $parts as $modifier ) {
			$index = array_search( $modifier, $order, true );
			if ( false === $index || $index <= $last_index ) {
				return false;
			}
			$last_index = $index;
			$has_owner  = $has_owner || 'Shift' !== $modifier;
		}

		return $has_owner ? $value : false;
	}

	private function is_canonical_shortcut_key( $value ) {
		$named_keys = array(
			'Space',
			'Enter',
			'Backspace',
			'Delete',
			'Insert',
			'Home',
			'End',
			'PageUp',
			'PageDown',
			'ArrowUp',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'Backquote',
			'Minus',
			'Equal',
			'BracketLeft',
			'BracketRight',
			'Backslash',
			'Semicolon',
			'Quote',
			'Comma',
			'Period',
			'Slash',
		);

		return 1 === preg_match( '/^[A-Z0-9]$/D', $value )
			|| 1 === preg_match( '/^F(?:[1-9]|1[0-2])$/D', $value )
			|| in_array( $value, $named_keys, true );
	}

	private function validated_registry_shortcut( array $command, $field, $is_mac ) {
		$value = array_key_exists( $field, $command ) ? $command[ $field ] : '';
		if ( false === $this->normalize_shortcut( $value, $is_mac ) ) {
			throw new \RuntimeException( 'easymde-toolbar-shortcut-invalid' );
		}

		return $value;
	}

	private function find_shortcut_conflict( array $shortcut_values ) {
		$owners = array(
			'windows' => array(),
			'mac'     => array(),
		);

		foreach ( $this->get_reserved_shortcuts_for_script() as $reserved ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$shortcut = $reserved[ $platform ];
				if ( '' === $shortcut ) {
					continue;
				}
				$binding = array(
					'id'       => $reserved['id'],
					'label'    => $reserved['label'],
					'editable' => false,
				);
				if ( isset( $owners[ $platform ][ $shortcut ] ) ) {
					if ( ! $owners[ $platform ][ $shortcut ]['editable'] && ! $binding['editable'] ) {
						continue;
					}
					return array(
						'platform' => $platform,
						'shortcut' => $shortcut,
						'bindings' => array( $owners[ $platform ][ $shortcut ], $binding ),
					);
				}
				$owners[ $platform ][ $shortcut ] = $binding;
			}
		}

		$editable_labels = $this->get_editable_shortcut_labels_for_script();
		foreach ( $shortcut_values as $shortcut_id => $shortcut ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$value = $shortcut[ $platform ];
				if ( '' === $value ) {
					continue;
				}
				$binding = array(
					'id'       => $shortcut_id,
					'label'    => isset( $editable_labels[ $shortcut_id ] ) ? $editable_labels[ $shortcut_id ] : $shortcut_id,
					'editable' => true,
				);
				if ( isset( $owners[ $platform ][ $value ] ) ) {
					return array(
						'platform' => $platform,
						'shortcut' => $value,
						'bindings' => array( $owners[ $platform ][ $value ], $binding ),
					);
				}
				$owners[ $platform ][ $value ] = $binding;
			}
		}

		return false;
	}

	private function get_editable_shortcut_labels_for_script() {
		$labels = array();
		foreach ( $this->toolbar_registry->get_commands_for_script() as $command ) {
			$command_id = isset( $command['id'] ) ? (string) $command['id'] : '';
			$center_id  = $this->center_shortcut_id( $command_id );
			if ( ! $center_id ) {
				continue;
			}
			$labels[ $center_id ] = isset( $command['label'] ) ? (string) $command['label'] : $center_id;
		}

		return $labels;
	}
	private function center_shortcut_id( $command_id ) {
		return ToolbarShortcutCatalog::settings_id_for_command( $command_id );
	}
}
