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
		$defaults             = $this->get_defaults();
		$settings             = isset( $stored['settings_center'] ) && is_array( $stored['settings_center'] )
			? $stored['settings_center']
			: array();
		$legacy_shortcut_mode = empty( $settings ) && isset( $stored['shortcuts'] ) && is_array( $stored['shortcuts'] );
		$settings             = $this->migrate_legacy_image_settings( $settings );
		$settings             = $this->merge_legacy_shortcuts_into_settings( $settings, $stored );

		$settings                             = $this->normalize_enum_settings( $this->merge_settings( $defaults, $settings ) );
		$settings['images']['endpoint']       = $this->sanitize_endpoint( $settings['images']['endpoint'] );
		$settings['images']['domain']         = $this->sanitize_domain( $settings['images']['domain'] );
		$settings['images']['backupEndpoint'] = $this->sanitize_endpoint( $settings['images']['backupEndpoint'] );
		$settings['images']['backupDomain']   = $this->sanitize_domain( $settings['images']['backupDomain'] );
		if ( ! $this->is_valid_file_name_rule( $settings['images']['fileNameRule'] ) ) {
			$settings['images']['fileNameRule'] = $defaults['images']['fileNameRule'];
		}
		foreach ( $settings['shortcuts']['values'] as $center_id => $shortcut ) {
			foreach ( array( 'windows', 'mac' ) as $platform ) {
				$normalized = $this->normalize_shortcut( $shortcut[ $platform ], 'mac' === $platform );
				if ( false === $normalized || ( $legacy_shortcut_mode && '' === $normalized ) ) {
					$normalized = $defaults['shortcuts']['values'][ $center_id ][ $platform ];
				}
				$settings['shortcuts']['values'][ $center_id ][ $platform ] = $normalized;
			}
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
		$settings = $this->get_settings();

		return $settings['general']['applyEditorThemeToFrontend'];
	}

	public function should_show_published_code_copy_button() {
		$settings = $this->get_settings();

		return $settings['general']['showPublishedCodeCopyButton'];
	}

	public function get_published_table_alignment() {
		$settings = $this->get_settings();

		return $settings['markdown']['tableAlignment'];
	}

	public function should_show_published_code_line_numbers() {
		$settings = $this->get_settings();

		return 'show' === $settings['markdown']['codeLineNumbers'];
	}

	public function get_shortcut_config_for_script() {
		$settings  = $this->get_settings();
		$stored    = $this->options->get_editor_settings();
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

			if ( isset( $stored['shortcuts'][ $command_id ] ) && is_array( $stored['shortcuts'][ $command_id ] ) ) {
				$shortcuts[ $command_id ] = array(
					'win' => isset( $stored['shortcuts'][ $command_id ]['win'] ) ? (string) $stored['shortcuts'][ $command_id ]['win'] : '',
					'mac' => isset( $stored['shortcuts'][ $command_id ]['mac'] ) ? (string) $stored['shortcuts'][ $command_id ]['mac'] : '',
				);
				continue;
			}

			$shortcuts[ $command_id ] = array(
				'win' => isset( $command['defaultShortcutWin'] ) ? (string) $command['defaultShortcutWin'] : '',
				'mac' => isset( $command['defaultShortcutMac'] ) ? (string) $command['defaultShortcutMac'] : '',
			);
		}

		return $shortcuts;
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
				'autoCompress'  => $images['compressImages'],
				'maxBytes'      => min( $images['maxImageSizeMb'] * MB_IN_BYTES, (int) wp_max_upload_size(), 10 * MB_IN_BYTES ),
				'uploadFormats' => array_keys( array_filter( $images['uploadFormats'] ) ),
				'titleDisplay'  => $images['titleDisplay'],
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
		$next['shortcuts']                = isset( $next['shortcuts'] ) && is_array( $next['shortcuts'] )
			? $next['shortcuts']
			: array();

		foreach ( $settings['shortcuts']['values'] as $center_id => $shortcut ) {
			$command_id = $this->shortcut_command_id( $center_id );
			if ( ! $command_id ) {
				continue;
			}

			$next['shortcuts'][ $command_id ] = array(
				'win' => $shortcut['windows'],
				'mac' => $shortcut['mac'],
			);
		}

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

		return $this->merge_legacy_shortcuts_into_settings( $settings, $stored );
	}

	private function merge_legacy_shortcuts_into_settings( array $settings, array $stored ) {
		if ( ! isset( $stored['shortcuts'] ) || ! is_array( $stored['shortcuts'] ) ) {
			return $settings;
		}

		if ( ! isset( $settings['shortcuts'] ) || ! is_array( $settings['shortcuts'] ) ) {
			$settings['shortcuts'] = array();
		}
		if ( ! isset( $settings['shortcuts']['values'] ) || ! is_array( $settings['shortcuts']['values'] ) ) {
			$settings['shortcuts']['values'] = array();
		}

		foreach ( $stored['shortcuts'] as $command_id => $values ) {
			$center_id = $this->center_shortcut_id( $command_id );
			if ( ! $center_id || ! is_array( $values ) ) {
				continue;
			}
			if ( ! isset( $settings['shortcuts']['values'][ $center_id ] ) || ! is_array( $settings['shortcuts']['values'][ $center_id ] ) ) {
				$settings['shortcuts']['values'][ $center_id ] = array();
			}
			foreach ( array(
				'win' => 'windows',
				'mac' => 'mac',
			) as $legacy_platform => $platform ) {
				if ( ! array_key_exists( $platform, $settings['shortcuts']['values'][ $center_id ] ) && array_key_exists( $legacy_platform, $values ) ) {
					$settings['shortcuts']['values'][ $center_id ][ $platform ] = (string) $values[ $legacy_platform ];
				}
			}
		}

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
				'windows' => isset( $command['defaultShortcutWin'] ) ? (string) $command['defaultShortcutWin'] : '',
				'mac'     => isset( $command['defaultShortcutMac'] ) ? (string) $command['defaultShortcutMac'] : '',
			);
		}

		return array(
			'general'   => array(
				'interfaceLanguage'           => 'zh-CN',
				'editingMode'                 => 'live-preview',
				'showLineNumbers'             => true,
				'syntaxHighlight'             => true,
				'statusBarMode'               => 'detailed',
				'autoSave'                    => true,
				'autoSaveInterval'            => '60',
				'syncScroll'                  => true,
				'publishVisibility'           => 'public',
				'openPreviewAfterPublish'     => true,
				'applyEditorThemeToFrontend'  => true,
				'showPublishedCodeCopyButton' => true,
				'summaryMode'                 => 'auto-55',
			),
			'images'    => array(
				'service'          => 'cloudflare-r2',
				'endpoint'         => '',
				'bucket'           => 'easymde-assets',
				'domain'           => '',
				'accessKey'        => '',
				'secretKey'        => '',
				'fileNameRule'     => '{date}/{uuid}.{ext}',
				'backupEnabled'    => false,
				'backupService'    => 'qiniu-kodo',
				'backupEndpoint'   => '',
				'backupBucket'     => 'easymde-backup',
				'backupDomain'     => '',
				'backupAccessKey'  => '',
				'backupSecretKey'  => '',
				'uploadRetryCount' => 0,
				'compressImages'   => true,
				'maxImageSizeMb'   => 5,
				'uploadFormats'    => array(
					'jpg'  => true,
					'png'  => true,
					'webp' => true,
					'gif'  => true,
				),
				'titleDisplay'     => 'none',
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
				'values'          => $shortcuts,
				'showHints'       => true,
				'detectConflicts' => true,
				'showSuggestions' => true,
			),
		);
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
		$settings['shortcuts']['showHints']       = (bool) $settings['shortcuts']['showHints'];
		$settings['shortcuts']['detectConflicts'] = (bool) $settings['shortcuts']['detectConflicts'];
		$settings['shortcuts']['showSuggestions'] = (bool) $settings['shortcuts']['showSuggestions'];

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
				'autoSaveInterval'  => '60',
				'publishVisibility' => 'public',
				'summaryMode'       => 'auto-55',
			),
			'images'   => array(
				'service'       => 'cloudflare-r2',
				'backupService' => 'qiniu-kodo',
				'titleDisplay'  => 'none',
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
				'service'       => array(
					'cloudflare-r2' => 'cloudflare-r2',
					'qiniu-kodo'    => 'qiniu-kodo',
					'aliyun-oss'    => 'aliyun-oss',
					'tencent-cos'   => 'tencent-cos',
				),
				'backupService' => array(
					'qiniu-kodo'    => 'qiniu-kodo',
					'cloudflare-r2' => 'cloudflare-r2',
					'aliyun-oss'    => 'aliyun-oss',
					'tencent-cos'   => 'tencent-cos',
				),
				'titleDisplay'  => array(
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
		$value = trim( (string) $value );
		if ( '' === $value ) {
			return '';
		}
		$parts = preg_split( '/\s*\+\s*/', $value );
		if ( ! is_array( $parts ) || count( $parts ) < 2 || count( $parts ) > 4 ) {
			return false;
		}
		$modifiers = array();
		$key       = '';
		foreach ( $parts as $part ) {
			$part  = trim( (string) $part );
			$lower = strtolower( $part );
			if ( in_array( $lower, array( 'mod', 'ctrl', 'control', 'cmd', 'command', 'alt', 'option', 'shift', 'meta' ), true ) ) {
				if ( in_array( $lower, array( 'mod', 'cmd', 'command', 'meta' ), true ) ) {
					$canonical = $is_mac ? 'Cmd' : ( 'mod' === $lower ? 'Ctrl' : 'Meta' );
				} elseif ( in_array( $lower, array( 'alt', 'option' ), true ) ) {
					$canonical = $is_mac ? 'Option' : 'Alt';
				} elseif ( 'shift' === $lower ) {
					$canonical = 'Shift';
				} else {
					$canonical = 'Ctrl';
				}
				if ( in_array( $canonical, $modifiers, true ) ) {
					return false;
				}
				$modifiers[] = $canonical;
				continue;
			}
			if ( '' !== $key ) {
				return false;
			}
			$key = $this->normalize_shortcut_key( $part );
			if ( false === $key ) {
				return false;
			}
		}
		if ( '' === $key || ( $is_mac && ! in_array( 'Cmd', $modifiers, true ) ) || ( ! $is_mac && ! in_array( 'Ctrl', $modifiers, true ) ) ) {
			return false;
		}
		$order                = $is_mac ? array( 'Cmd', 'Ctrl', 'Option', 'Shift' ) : array( 'Ctrl', 'Alt', 'Shift', 'Meta' );
		$normalized_modifiers = array();
		foreach ( $order as $modifier ) {
			if ( in_array( $modifier, $modifiers, true ) ) {
				$normalized_modifiers[] = $modifier;
			}
		}
		return implode( '+', array_merge( $normalized_modifiers, array( $key ) ) );
	}

	private function normalize_shortcut_key( $value ) {
		$value   = trim( (string) $value );
		$special = array(
			'space'      => 'Space',
			'enter'      => 'Enter',
			'return'     => 'Enter',
			'escape'     => 'Escape',
			'esc'        => 'Escape',
			'tab'        => 'Tab',
			'backspace'  => 'Backspace',
			'delete'     => 'Delete',
			'insert'     => 'Insert',
			'home'       => 'Home',
			'end'        => 'End',
			'pageup'     => 'PageUp',
			'pagedown'   => 'PageDown',
			'arrowup'    => 'ArrowUp',
			'arrowdown'  => 'ArrowDown',
			'arrowleft'  => 'ArrowLeft',
			'arrowright' => 'ArrowRight',
		);
		$lower   = strtolower( $value );
		if ( isset( $special[ $lower ] ) ) {
			return $special[ $lower ];
		}
		if ( preg_match( '/^F(?:[1-9]|1[0-2])$/i', $value ) ) {
			return strtoupper( $value );
		}
		return preg_match( '/^[A-Za-z0-9`\[\]\\;\'\/,\.\-=]+$/', $value ) ? strtoupper( $value ) : false;
	}


	private function center_shortcut_id( $command_id ) {
		$map = array(
			'savepost'      => 'save',
			'bold'          => 'bold',
			'italic'        => 'italic',
			'link'          => 'link',
			'image'         => 'image',
			'heading1'      => 'heading-one',
			'heading2'      => 'heading-two',
			'quote'         => 'quote',
			'unorderedlist' => 'unordered-list',
			'orderedlist'   => 'ordered-list',
		);
		return isset( $map[ $command_id ] ) ? $map[ $command_id ] : false;
	}

	private function shortcut_command_id( $center_id ) {
		$map        = array(
			'save'           => 'savepost',
			'bold'           => 'bold',
			'italic'         => 'italic',
			'link'           => 'link',
			'image'          => 'image',
			'heading-one'    => 'heading1',
			'heading-two'    => 'heading2',
			'quote'          => 'quote',
			'unordered-list' => 'unorderedlist',
			'ordered-list'   => 'orderedlist',
		);
		$command_id = isset( $map[ $center_id ] ) ? $map[ $center_id ] : '';
		return '' !== $command_id && isset( $this->toolbar_registry->get_command_registry()[ $command_id ] )
			? $command_id
			: false;
	}
}
