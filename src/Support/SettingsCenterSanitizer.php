<?php

namespace EasyMDE\Support;

use EasyMDE\ImageHosting\ImageHostDestinationIdentity;
use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\ImageHostProviderSupport;
use EasyMDE\ImageHosting\ImageUploadExtensionPolicy;
use EasyMDE\ImageHosting\ObjectKeyBuilder;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsCenterSanitizer {

	public function migrate_legacy_image_settings( array $settings ) {
		if ( ! isset( $settings['images'] ) || ! is_array( $settings['images'] ) ) {
			return $settings;
		}

		if ( array_key_exists( 'uploadFormats', $settings['images'] ) ) {
			$formats = ImageUploadExtensionPolicy::normalize( $settings['images']['uploadFormats'] );
			if ( false === $formats ) {
				// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Stable internal configuration code, not output.
				throw new \RuntimeException( SettingsCenterRepository::CONFIGURATION_ERROR_CODE );
			}
			$settings['images']['uploadFormats'] = $formats;
		}

		if ( ! array_key_exists( 'titleDisplay', $settings['images'] ) && isset( $settings['images']['captionMode'] ) ) {
			$settings['images']['titleDisplay'] = 'filename' === $settings['images']['captionMode'] ? 'filename' : 'none';
		}

		if ( ! array_key_exists( 'storagePath', $settings['images'] ) && array_key_exists( 'fileNameRule', $settings['images'] ) ) {
			$split = ObjectKeyBuilder::split_legacy_template( $settings['images']['fileNameRule'] );
			if ( ! is_array( $split ) ) {
				// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Stable internal configuration code, not output.
				throw new \RuntimeException( SettingsCenterRepository::CONFIGURATION_ERROR_CODE );
			}
			$settings['images']['storagePath']  = $split[0];
			$settings['images']['fileNameRule'] = $split[1];
		} elseif (
			array_key_exists( 'storagePath', $settings['images'] ) &&
			array_key_exists( 'fileNameRule', $settings['images'] ) &&
			is_string( $settings['images']['storagePath'] ) &&
			is_string( $settings['images']['fileNameRule'] ) &&
			false !== strpos( $settings['images']['fileNameRule'], '{ext}' )
		) {
			$legacy_template = ( new ObjectKeyBuilder() )->combine(
				$settings['images']['storagePath'],
				$settings['images']['fileNameRule']
			);
			$split           = ObjectKeyBuilder::split_legacy_template( $legacy_template );
			if ( ! is_array( $split ) || $split[0] !== $settings['images']['storagePath'] ) {
				// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Stable internal configuration code, not output.
				throw new \RuntimeException( SettingsCenterRepository::CONFIGURATION_ERROR_CODE );
			}
			$settings['images']['fileNameRule'] = $split[1];
		}

		return $settings;
	}

	public function assert_canonical_image_settings( array $settings ) {
		if ( ! isset( $settings['images'] ) || ! is_array( $settings['images'] ) || ! array_key_exists( 'storagePath', $settings['images'] ) ) {
			return;
		}

		if (
			! array_key_exists( 'fileNameRule', $settings['images'] ) ||
			! is_string( $settings['images']['storagePath'] ) ||
			! is_string( $settings['images']['fileNameRule'] ) ||
			! $this->is_valid_file_name_rule( $settings['images']['storagePath'], $settings['images']['fileNameRule'] )
		) {
			// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Stable internal configuration code, not output.
			throw new \RuntimeException( SettingsCenterRepository::CONFIGURATION_ERROR_CODE );
		}
	}

	public function merge_settings( array $defaults, array $stored ) {
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

	public function sanitize_settings(
		array $input,
		array $defaults,
		array $stored_settings,
		$reset_secrets,
		SettingsCenterShortcuts $shortcuts
	) {
		if ( isset( $input['general'] ) && is_array( $input['general'] ) ) {
			foreach ( array( 'applyEditorThemeToFrontend', 'showPublishedCodeCopyButton' ) as $boolean_field ) {
				if ( array_key_exists( $boolean_field, $input['general'] ) && ! is_bool( $input['general'][ $boolean_field ] ) ) {
					return $this->invalid_payload_error();
				}
			}
		}
		if ( isset( $input['images'] ) && is_array( $input['images'] ) ) {
			if (
				array_key_exists( 'imageHostingEnabled', $input['images'] ) && ! is_bool( $input['images']['imageHostingEnabled'] )
			) {
				return $this->invalid_payload_error();
			}
			if (
				array_key_exists( 'wechatPngExportEnabled', $input['images'] ) && ! is_bool( $input['images']['wechatPngExportEnabled'] )
			) {
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
					return $this->invalid_payload_error();
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
		if ( isset( $input['images']['uploadFormats'] ) ) {
			$formats = ImageUploadExtensionPolicy::normalize( $input['images']['uploadFormats'] );
			if ( false === $formats ) {
				return $this->invalid_payload_error();
			}
			$input['images']['uploadFormats'] = $formats;
		}
		$stored_settings = $this->migrate_legacy_image_settings( $stored_settings );
		$input           = $this->migrate_legacy_image_settings( $input );
		$base            = $this->merge_settings( $defaults, $stored_settings );
		$settings        = $this->merge_settings( $base, $input );
		$settings        = $this->normalize_enum_settings( $settings );
		if (
			! $this->is_valid_provider_coordinates( $settings['images']['service'], $settings['images']['endpoint'] ) ||
			! $this->is_valid_provider_coordinates( $settings['images']['backupService'], $settings['images']['backupEndpoint'] ) ||
			! $this->is_valid_file_name_rule( $settings['images']['storagePath'], $settings['images']['fileNameRule'] )
		) {
			return $this->invalid_payload_error();
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
				// The exact six-key map was validated before sanitization.
				$settings['images']['uploadFormats'] = ImageUploadExtensionPolicy::normalize( $value );
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

		$sanitized_shortcuts = $shortcuts->sanitize_shortcut_values( $settings['shortcuts']['values'] );
		if ( is_wp_error( $sanitized_shortcuts ) ) {
			return $sanitized_shortcuts;
		}
		$settings['shortcuts']['values'] = $sanitized_shortcuts;

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

	public function normalize_enum_settings( array $settings ) {
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

	public function bounded_text( $value, $length ) {
		$value = sanitize_text_field( (string) $value );

		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $length ) : substr( $value, 0, $length );
	}

	public function sanitize_domain( $value ) {
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

	public function sanitize_endpoint( $value ) {
		$value = strtolower( rtrim( trim( (string) $value ), '/' ) );

		return $this->is_valid_endpoint( $value ) ? $this->bounded_text( $value, 255 ) : '';
	}

	public function is_valid_file_name_rule( $storage_path, $file_name_rule ) {
		try {
			( new ObjectKeyBuilder() )->validate( $storage_path, $file_name_rule );

			return true;
		} catch ( ImageHostException $exception ) {
			return false;
		}
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

	private function invalid_payload_error() {
		return new WP_Error(
			'easymde_settings_invalid_payload',
			__( 'The settings payload is invalid.', 'easymde' ),
			array( 'status' => 400 )
		);
	}
}
