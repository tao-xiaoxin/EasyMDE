<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;
use DateTimeZone;
use Throwable;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImageHostingRuntime {

	const BACKUP_FAILURE_CODE = 'easymde_image_hosting_backup_upload_failed';
	const IMAGE_QUALITY       = 82;

	private $transport;
	private $key_builder;
	private $clock;
	private $uuid_factory;
	private $image_editor_factory;
	private $validation_image_loader;

	public function __construct(
		HttpTransport $transport,
		?ObjectKeyBuilder $key_builder = null,
		?callable $clock = null,
		?callable $uuid_factory = null,
		?callable $image_editor_factory = null,
		?callable $validation_image_loader = null
	) {
		$this->transport               = $transport;
		$this->key_builder             = null === $key_builder ? new ObjectKeyBuilder() : $key_builder;
		$this->clock                   = null === $clock
			? static function () {
				return new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
			}
			: $clock;
		$this->uuid_factory            = null === $uuid_factory ? 'wp_generate_uuid4' : $uuid_factory;
		$this->image_editor_factory    = null === $image_editor_factory ? 'wp_get_image_editor' : $image_editor_factory;
		$this->validation_image_loader = null === $validation_image_loader
			? array( $this, 'load_validation_image' )
			: $validation_image_loader;
	}

	public function validate_upload( array $settings, $target ) {
		if (
			! in_array( $target, array( 'primary', 'backup' ), true ) ||
			( 'backup' === $target && empty( $settings['backup']['enabled'] ) ) ||
			! isset( $settings['primary'] ) ||
			! is_array( $settings['primary'] ) ||
			! isset( $settings['primary']['domain'] ) ||
			! $this->is_valid_public_domain( $settings['primary']['domain'] ) ||
			! isset( $settings[ $target ] ) ||
			! is_array( $settings[ $target ] ) ||
			! isset( $settings[ $target ]['domain'] ) ||
			! $this->is_valid_public_domain( $settings[ $target ]['domain'] )
		) {
			return $this->configuration_error();
		}
		if ( $this->has_duplicate_destinations( $settings ) ) {
			return $this->duplicate_destination_error();
		}

		try {
			$bytes = call_user_func( $this->validation_image_loader );
			if (
				! is_string( $bytes ) ||
				strlen( $bytes ) < 8 ||
				strlen( $bytes ) > ImageHostProviderSupport::MAX_IMAGE_BYTES ||
				"\x89PNG\r\n\x1a\n" !== substr( $bytes, 0, 8 )
			) {
				return $this->operation_error( 'easymde_image_hosting_validation_image_invalid' );
			}

			$path = $this->build_object_key(
				$settings['fileNameRule'],
				$bytes,
				'easymde-editor-icon.png',
				'image/png',
				0
			);
			if ( is_wp_error( $path ) ) {
				return $path;
			}
			$provider = $this->create_provider( $settings[ $target ] );
			$result   = $provider->upload( $bytes, 'image/png', $path );
		} catch ( Throwable $throwable ) {
			return $this->operation_error( 'easymde_image_hosting_validation_upload_failed' );
		}

		if ( ! $result->is_success() || $path !== $result->get_key() ) {
			return $this->operation_error( 'easymde_image_hosting_validation_upload_failed' );
		}

		return array(
			'status' => 'uploaded',
			'path'   => $path,
			'url'    => ImageHostProviderSupport::public_url( $settings['primary']['domain'], $path ),
		);
	}

	public function upload( array $settings, array $file ) {
		if ( ! $this->is_valid_upload_configuration( $settings ) || ! $this->is_valid_file( $file ) ) {
			return $this->configuration_error();
		}
		if ( $this->has_duplicate_destinations( $settings ) ) {
			return $this->duplicate_destination_error();
		}
		try {
			$primary_provider = $this->create_provider( $settings['primary'] );
		} catch ( Throwable $throwable ) {
			return $this->configuration_error();
		}

		try {
			$prepared = $this->prepare_file( $file, $settings['behaviors'] );
		} catch ( Throwable $throwable ) {
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}
		if ( is_wp_error( $prepared ) ) {
			return $prepared;
		}

		try {
			$rule = ! empty( $settings['behaviors']['preserveOriginalName'] )
				? '{date}/{name}.{ext}'
				: $settings['fileNameRule'];
			$key  = $this->build_object_key(
				$rule,
				$prepared['bytes'],
				$file['name'],
				$prepared['mime_type'],
				isset( $file['post_id'] ) ? (int) $file['post_id'] : 0
			);
			if ( is_wp_error( $key ) ) {
				return $key;
			}

			$primary_result = $this->upload_with_retries(
				$primary_provider,
				$prepared,
				$key,
				$settings['primary']['retryCount']
			);
			if ( null === $primary_result || ! $primary_result->is_success() || $key !== $primary_result->get_key() ) {
				return $this->operation_error( 'easymde_image_hosting_primary_upload_failed' );
			}

			$backup = array( 'status' => 'disabled' );
			if ( ! empty( $settings['backup']['enabled'] ) ) {
				try {
					$backup_provider = $this->create_provider( $settings['backup'] );
					$backup          = $this->upload_backup(
						$backup_provider,
						$prepared,
						$key,
						$settings['backup']['retryCount']
					);
				} catch ( Throwable $throwable ) {
					$backup = $this->operation_error( self::BACKUP_FAILURE_CODE );
				}
				if ( is_wp_error( $backup ) ) {
					return $backup;
				}
			}

			return array(
				'url'    => ImageHostProviderSupport::public_url( $settings['primary']['domain'], $key ),
				'path'   => $key,
				'alt'    => $this->derived_text( $settings['behaviors']['altSource'], $file['name'] ),
				'title'  => $this->derived_text( $settings['behaviors']['captionMode'], $file['name'] ),
				'backup' => $backup,
			);
		} catch ( ImageHostException $exception ) {
			return $this->configuration_error();
		} catch ( Throwable $throwable ) {
			return $this->operation_error( 'easymde_image_hosting_upload_failed' );
		} finally {
			$this->remove_owned_files( $prepared['cleanup'] );
		}
	}

	private function upload_backup( $provider, array $prepared, $key, $retry_count ) {
		$result = $this->upload_with_retries( $provider, $prepared, $key, $retry_count );
		if ( null !== $result && $result->is_success() && $key === $result->get_key() ) {
			return array( 'status' => 'uploaded' );
		}

		return $this->operation_error( self::BACKUP_FAILURE_CODE );
	}

	private function upload_with_retries( $provider, array $prepared, $key, $retry_count ) {
		for ( $attempt = 0; $attempt <= $retry_count; $attempt++ ) {
			try {
				$result = $provider->upload( $prepared['bytes'], $prepared['mime_type'], $key );
			} catch ( Throwable $throwable ) {
				$result = null;
			}

			if ( null !== $result && $result->is_success() && $key === $result->get_key() ) {
				return $result;
			}
		}

		return null;
	}

	private function build_object_key( $rule, $bytes, $original_filename, $mime_type, $post_id ) {
		$now = call_user_func( $this->clock );
		if ( ! $now instanceof DateTimeImmutable ) {
			return $this->operation_error( 'easymde_image_hosting_clock_failed' );
		}

		return $this->key_builder->build(
			$rule,
			$bytes,
			$original_filename,
			$mime_type,
			$post_id,
			$now->setTimezone( new DateTimeZone( 'UTC' ) ),
			call_user_func( $this->uuid_factory )
		);
	}

	private function create_provider( array $config ) {
		$service = isset( $config['service'] ) ? $config['service'] : '';
		if ( 'cloudflare-r2' === $service ) {
			return new CloudflareR2Provider(
				$this->transport,
				isset( $config['endpoint'] ) ? $config['endpoint'] : '',
				isset( $config['accessKey'] ) ? $config['accessKey'] : '',
				isset( $config['secretKey'] ) ? $config['secretKey'] : '',
				isset( $config['bucket'] ) ? $config['bucket'] : '',
				isset( $config['domain'] ) ? $config['domain'] : '',
				$this->clock
			);
		}

		if ( 'qiniu-kodo' === $service ) {
			$clock = $this->clock;
			return new QiniuKodoProvider(
				$this->transport,
				isset( $config['accessKey'] ) ? $config['accessKey'] : '',
				isset( $config['secretKey'] ) ? $config['secretKey'] : '',
				isset( $config['bucket'] ) ? $config['bucket'] : '',
				isset( $config['domain'] ) ? $config['domain'] : '',
				static function () use ( $clock ) {
					$now = call_user_func( $clock );

					return $now instanceof DateTimeImmutable ? $now->getTimestamp() : 0;
				}
			);
		}

		if ( 'aliyun-oss' === $service ) {
			return new AlibabaOssProvider(
				$this->transport,
				isset( $config['endpoint'] ) ? $config['endpoint'] : '',
				isset( $config['accessKey'] ) ? $config['accessKey'] : '',
				isset( $config['secretKey'] ) ? $config['secretKey'] : '',
				isset( $config['bucket'] ) ? $config['bucket'] : '',
				isset( $config['domain'] ) ? $config['domain'] : '',
				$this->clock
			);
		}

		if ( 'tencent-cos' === $service ) {
			$clock = $this->clock;
			return new TencentCosProvider(
				$this->transport,
				isset( $config['endpoint'] ) ? $config['endpoint'] : '',
				isset( $config['accessKey'] ) ? $config['accessKey'] : '',
				isset( $config['secretKey'] ) ? $config['secretKey'] : '',
				isset( $config['bucket'] ) ? $config['bucket'] : '',
				isset( $config['domain'] ) ? $config['domain'] : '',
				static function () use ( $clock ) {
					$now = call_user_func( $clock );

					return $now instanceof DateTimeImmutable ? $now->getTimestamp() : 0;
				}
			);
		}

		throw new ImageHostException( 'image_host_unsupported_provider' );
	}

	private function prepare_file( array $file, array $behaviors ) {
		$bytes = $this->read_local_file( $file['tmp_name'] );
		if ( false === $bytes || '' === $bytes ) {
			return $this->operation_error( 'easymde_image_hosting_file_unreadable' );
		}

		$mime_type     = $file['type'];
		$auto_compress = ! empty( $behaviors['autoCompress'] );
		$maximum_size  = isset( $behaviors['maxImageSize'] ) ? (string) $behaviors['maxImageSize'] : 'original';
		if ( ! in_array( $maximum_size, array( 'original', '1920', '2560', '3840' ), true ) ) {
			return $this->configuration_error();
		}

		if ( 'image/gif' === $mime_type || ( ! $auto_compress && 'original' === $maximum_size ) ) {
			return array(
				'bytes'     => $bytes,
				'mime_type' => $mime_type,
				'cleanup'   => array(),
			);
		}

		$editor = call_user_func( $this->image_editor_factory, $file['tmp_name'] );
		if ( is_wp_error( $editor ) || ! is_object( $editor ) ) {
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}

		$changed = false;
		if ( 'original' !== $maximum_size ) {
			$size = $editor->get_size();
			if ( ! is_array( $size ) || ! isset( $size['width'], $size['height'] ) ) {
				return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
			}

			$maximum = (int) $maximum_size;
			if ( (int) $size['width'] > $maximum || (int) $size['height'] > $maximum ) {
				$resized = $editor->resize( $maximum, $maximum, false );
				if ( is_wp_error( $resized ) ) {
					return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
				}
				$changed = true;
			}
		}

		if ( $auto_compress ) {
			$quality = $editor->set_quality( self::IMAGE_QUALITY );
			if ( is_wp_error( $quality ) ) {
				return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
			}
			$changed = true;
		}

		if ( ! $changed ) {
			return array(
				'bytes'     => $bytes,
				'mime_type' => $mime_type,
				'cleanup'   => array(),
			);
		}

		if ( ! function_exists( 'wp_tempnam' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( ! function_exists( 'wp_tempnam' ) ) {
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}
		$temporary_path = wp_tempnam( 'easymde-image-host' );
		if ( ! is_string( $temporary_path ) || '' === $temporary_path ) {
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}

		$expected_path = $this->expected_editor_path( $temporary_path, $mime_type );
		$cleanup       = array_values( array_unique( array( $temporary_path, $expected_path ) ) );
		try {
			$saved = $editor->save( $temporary_path, $mime_type );
		} catch ( Throwable $throwable ) {
			$this->remove_owned_files( $cleanup );
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}
		if (
			is_wp_error( $saved ) ||
			! is_array( $saved ) ||
			! isset( $saved['path'] ) ||
			$expected_path !== $saved['path'] ||
			( isset( $saved['mime-type'] ) ? $saved['mime-type'] : '' ) !== $mime_type
		) {
			$this->remove_owned_files( $cleanup );
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}

		try {
			$prepared_bytes = is_readable( $saved['path'] ) ? $this->read_local_file( $saved['path'] ) : false;
		} catch ( Throwable $throwable ) {
			$this->remove_owned_files( $cleanup );
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}
		if (
			false === $prepared_bytes ||
			'' === $prepared_bytes ||
			strlen( $prepared_bytes ) > ImageHostProviderSupport::MAX_IMAGE_BYTES
		) {
			$this->remove_owned_files( $cleanup );
			return $this->operation_error( 'easymde_image_hosting_image_processing_failed' );
		}

		return array(
			'bytes'     => $prepared_bytes,
			'mime_type' => $mime_type,
			'cleanup'   => array_values( array_unique( $cleanup ) ),
		);
	}

	private function remove_owned_files( array $paths ) {
		foreach ( array_unique( $paths ) as $path ) {
			if ( is_string( $path ) && '' !== $path && is_file( $path ) ) {
				wp_delete_file( $path );
			}
		}
	}

	private function read_local_file( $path ) {
		// Uploads and editor output are validated local temporary files, never URLs.
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		return file_get_contents( $path );
	}

	private function load_validation_image() {
		$path = EASYMDE_PLUGIN_DIR . 'assets/images/easymde-editor-icon.png';
		$size = is_file( $path ) && is_readable( $path ) ? filesize( $path ) : false;

		return false !== $size && $size >= 8 && $size <= ImageHostProviderSupport::MAX_IMAGE_BYTES
			? $this->read_local_file( $path )
			: false;
	}

	private function expected_editor_path( $temporary_path, $mime_type ) {
		$extensions = ObjectKeyBuilder::MIME_EXTENSIONS;
		$extension  = isset( $extensions[ $mime_type ] ) ? $extensions[ $mime_type ] : '';
		$path       = preg_replace( '/\.[^.]+$/', '.' . $extension, $temporary_path );

		return is_string( $path ) && $temporary_path !== $path
			? $path
			: $temporary_path . '.' . $extension;
	}

	private function derived_text( $mode, $file_name ) {
		if ( 'filename' !== $mode ) {
			return '';
		}

		$name = pathinfo( sanitize_file_name( $file_name ), PATHINFO_FILENAME );
		$name = str_replace( array( '-', '_' ), ' ', $name );

		return trim( sanitize_text_field( $name ) );
	}

	private function is_valid_upload_configuration( array $settings ) {
		if (
			! isset( $settings['primary'], $settings['backup'], $settings['fileNameRule'], $settings['behaviors'] ) ||
			! is_array( $settings['primary'] ) ||
			! is_array( $settings['backup'] ) ||
			! is_array( $settings['behaviors'] ) ||
			! isset( $settings['primary']['domain'] ) ||
			! $this->is_valid_public_domain( $settings['primary']['domain'] ) ||
			! isset( $settings['primary']['retryCount'] ) ||
			! is_int( $settings['primary']['retryCount'] ) ||
			$settings['primary']['retryCount'] < 0 ||
			$settings['primary']['retryCount'] > 5 ||
			! isset( $settings['backup']['retryCount'] ) ||
			! is_int( $settings['backup']['retryCount'] ) ||
			$settings['backup']['retryCount'] < 0 ||
			$settings['backup']['retryCount'] > 5
		) {
			return false;
		}

		return isset(
			$settings['behaviors']['autoCompress'],
			$settings['behaviors']['preserveOriginalName'],
			$settings['behaviors']['maxImageSize'],
			$settings['behaviors']['altSource'],
			$settings['behaviors']['captionMode']
		);
	}

	private function is_valid_public_domain( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return false;
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
			( ! isset( $parts['path'] ) || '' === $parts['path'] || '/' === $parts['path'] );
	}

	private function is_valid_file( array $file ) {
		return isset( $file['name'], $file['type'], $file['tmp_name'] ) &&
			is_string( $file['name'] ) &&
			is_string( $file['type'] ) &&
			is_string( $file['tmp_name'] ) &&
			is_file( $file['tmp_name'] ) &&
			is_readable( $file['tmp_name'] ) &&
			in_array( $file['type'], ImageHostProviderSupport::ALLOWED_MIME_TYPES, true );
	}

	private function configuration_error() {
		return $this->operation_error( 'easymde_image_hosting_configuration_invalid' );
	}

	private function duplicate_destination_error() {
		return new WP_Error(
			'easymde_image_hosting_duplicate_destination',
			__( 'The primary and backup image hosts must use different storage destinations.', 'easymde' ),
			array( 'status' => 409 )
		);
	}

	private function has_duplicate_destinations( array $settings ) {
		return ! empty( $settings['backup']['enabled'] ) &&
			isset( $settings['primary'], $settings['backup'] ) &&
			is_array( $settings['primary'] ) &&
			is_array( $settings['backup'] ) &&
			ImageHostDestinationIdentity::are_same( $settings['primary'], $settings['backup'] );
	}

	private function operation_error( $error_code ) {
		return new WP_Error(
			$error_code,
			__( 'The image-hosting operation could not be completed.', 'easymde' ),
			array( 'status' => 502 )
		);
	}
}
