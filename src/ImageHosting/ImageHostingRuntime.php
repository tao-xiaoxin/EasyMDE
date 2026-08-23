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

	public function __construct(
		HttpTransport $transport,
		?ObjectKeyBuilder $key_builder = null,
		?callable $clock = null,
		?callable $uuid_factory = null,
		?callable $image_editor_factory = null
	) {
		$this->transport            = $transport;
		$this->key_builder          = null === $key_builder ? new ObjectKeyBuilder() : $key_builder;
		$this->clock                = null === $clock
			? static function () {
				return new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
			}
			: $clock;
		$this->uuid_factory         = null === $uuid_factory ? 'wp_generate_uuid4' : $uuid_factory;
		$this->image_editor_factory = null === $image_editor_factory ? 'wp_get_image_editor' : $image_editor_factory;
	}

	public function test_connection( array $settings, $target ) {
		if ( ! in_array( $target, array( 'primary', 'backup' ), true ) ) {
			return $this->configuration_error();
		}

		if ( 'backup' === $target && ( empty( $settings['backup']['enabled'] ) || empty( $settings['backup']['sameObjectKey'] ) ) ) {
			return $this->configuration_error();
		}

		$config = isset( $settings[ $target ] ) && is_array( $settings[ $target ] ) ? $settings[ $target ] : array();
		try {
			$provider = $this->create_provider( $config );
			$result   = $provider->probe();
		} catch ( Throwable $throwable ) {
			return $this->operation_error( 'easymde_image_hosting_connection_failed' );
		}

		return $result->is_success()
			? array( 'status' => 'connected' )
			: $this->operation_error( 'easymde_image_hosting_connection_failed' );
	}

	public function upload( array $settings, array $file ) {
		if ( ! $this->is_valid_upload_configuration( $settings ) || ! $this->is_valid_file( $file ) ) {
			return $this->configuration_error();
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
			$now = call_user_func( $this->clock );
			if ( ! $now instanceof DateTimeImmutable ) {
				return $this->operation_error( 'easymde_image_hosting_clock_failed' );
			}
			$now = $now->setTimezone( new DateTimeZone( 'UTC' ) );

			$uuid = call_user_func( $this->uuid_factory );
			$rule = ! empty( $settings['behaviors']['preserveOriginalName'] )
				? '{date}/{name}.{ext}'
				: $settings['fileNameRule'];
			$key  = $this->key_builder->build(
				$rule,
				$prepared['bytes'],
				$file['name'],
				$prepared['mime_type'],
				isset( $file['post_id'] ) ? (int) $file['post_id'] : 0,
				$now,
				$uuid
			);

			$primary_result = $primary_provider->upload( $prepared['bytes'], $prepared['mime_type'], $key );
			if ( ! $primary_result->is_success() ) {
				return $this->operation_error( 'easymde_image_hosting_primary_upload_failed' );
			}

			$backup = array( 'status' => 'disabled' );
			if ( ! empty( $settings['backup']['enabled'] ) ) {
				try {
					$backup_provider = $this->create_provider( $settings['backup'] );
					$backup_result   = $backup_provider->upload(
						$prepared['bytes'],
						$prepared['mime_type'],
						$key
					);
				} catch ( Throwable $throwable ) {
					$backup_result = null;
				}
				if ( null === $backup_result || ! $backup_result->is_success() ) {
					$backup = array(
						'status' => 'failed',
						'code'   => self::BACKUP_FAILURE_CODE,
					);
				} else {
					$backup = array( 'status' => 'uploaded' );
				}
			}

			return array(
				'url'    => $primary_result->get_url(),
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

	private function create_provider( array $config ) {
		$service = isset( $config['service'] ) ? $config['service'] : '';
		if ( 'cloudflare-r2' === $service ) {
			return new CloudflareR2Provider(
				$this->transport,
				isset( $config['accountId'] ) ? $config['accountId'] : '',
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
			! is_array( $settings['behaviors'] )
		) {
			return false;
		}

		if ( ! empty( $settings['backup']['enabled'] ) ) {
			if (
				empty( $settings['backup']['sameObjectKey'] ) ||
				! isset( $settings['backup']['failureMode'] ) ||
				'continue' !== $settings['backup']['failureMode']
			) {
				return false;
			}
		}

		return isset(
			$settings['behaviors']['autoCompress'],
			$settings['behaviors']['preserveOriginalName'],
			$settings['behaviors']['maxImageSize'],
			$settings['behaviors']['altSource'],
			$settings['behaviors']['captionMode']
		);
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

	private function operation_error( $error_code ) {
		return new WP_Error(
			$error_code,
			__( 'The image-hosting operation could not be completed.', 'easymde' ),
			array( 'status' => 502 )
		);
	}
}
